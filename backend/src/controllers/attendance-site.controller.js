const crypto = require("crypto")
const { Prisma } = require("@prisma/client")
const prisma = require("../lib/prisma")
const { distanceMeters } = require("../utils/geo")
const { normalizeBoundary, siteDistance, polygonCentroid, polygonPerimeterMeters, polygonAreaSqMeters } = require("../utils/site-geofence")

const MANAGEMENT = ["ADMIN", "CEO", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]

function isManagement(req) {
  return MANAGEMENT.includes(req.user?.role)
}

function id() {
  return `site_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`
}

async function getOrganizationScope(req) {
  const current = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: {
      id: true,
      companyId: true,
      parentOrganizationId: true,
      archivedAt: true,
    },
  })

  if (!current || current.archivedAt) return null

  const companyId = current.companyId || current.id
  const isMainCompany =
    !current.parentOrganizationId &&
    (!current.companyId || current.companyId === current.id)

  // ADMIN gets company-wide organization scope only when their own account
  // belongs to the main company. A sub-company ADMIN is organization-scoped.
  const companyWideAdmin = req.user.role === "ADMIN" && isMainCompany

  // CEO keeps existing company-wide behavior.
  const companyWide = companyWideAdmin || req.user.role === "CEO"

  if (!companyWide) {
    return {
      current,
      companyId,
      isMainCompany,
      companyWide: false,
      organizationIds: [current.id],
    }
  }

  const organizations = await prisma.organization.findMany({
    where: {
      archivedAt: null,
      OR: [{ id: companyId }, { companyId }],
    },
    select: { id: true },
  })

  return {
    current,
    companyId,
    isMainCompany,
    companyWide: true,
    organizationIds: organizations.map((org) => org.id),
  }
}

function canUseOrganization(scope, organizationId) {
  return !!scope && scope.organizationIds.includes(organizationId)
}

function isValidTimeZone(value) {
  if (!value) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: String(value) }).format()
    return true
  } catch {
    return false
  }
}

function isCompletedProject(project) {
  return String(project?.status || "").toUpperCase() === "COMPLETED"
}

async function listSites(req, res, next) {
  try {
    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const sites = await prisma.$queryRaw`
      SELECT
        s.*,
        o.name AS "organizationName",
        u.name AS "managerName",
        p.name AS "projectName",
        p.status::text AS "projectStatus",
        COUNT(se."employeeId")::int AS "employeeCount"
      FROM "AttendanceSite" s
      JOIN "Organization" o ON o.id = s."organizationId"
      LEFT JOIN "User" u ON u.id = s."managerId"
      LEFT JOIN "Project" p ON p.id = s."projectId"
      LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId" = s.id
      WHERE s."organizationId" IN (${Prisma.join(scope.organizationIds)})
      GROUP BY s.id, o.name, u.name, p.name, p.status
      ORDER BY s."active" DESC, o.name ASC, s.name ASC
    `
    res.json(sites)
  } catch (err) {
    next(err)
  }
}

async function listAssignedSites(req, res, next) {
  try {
    const sites = await prisma.$queryRaw`
      SELECT
        s.id, s.name, s.address, s.latitude, s.longitude,
        s."radiusMeters", s.timezone, s."geofenceMode", s."active", s."projectId",
        s."outsideGraceMinutes", s."autoFinalize", s."geofenceType", s.boundary, s."areaSqMeters", s."perimeterMeters", se."isPrimary",
        p.name AS "projectName"
      FROM "AttendanceSite" s
      LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${req.user.userId}
      LEFT JOIN "Project" p ON p.id=s."projectId"
      WHERE s."organizationId" = ${req.user.organizationId}
        AND s.active = TRUE
        AND (s."projectId" IS NULL OR p.status::text <> 'COMPLETED')
        AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${req.user.userId}))
      ORDER BY COALESCE(se."isPrimary",FALSE) DESC, s.name ASC
    `
    res.json(sites)
  } catch (err) {
    next(err)
  }
}

async function listSiteProjects(req, res, next) {
  try {
    const scope=await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error:"Organization not found" })
    const organizationId=String(req.query.organizationId || req.user.organizationId)
    if (!canUseOrganization(scope,organizationId)) return res.status(403).json({ error:"You do not have access to this organization" })
    const projects=await prisma.project.findMany({ where:{ organizationId, NOT:{ status:"COMPLETED" } }, select:{id:true,name:true,status:true}, orderBy:{name:"asc"} })
    res.json(projects)
  } catch(err) { next(err) }
}

async function createSite(req, res, next) {
  try {
    if (!isManagement(req)) return res.status(403).json({ error: "Attendance site management is restricted" })

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    // Main-company ADMIN may explicitly create the site for any company org.
    // Sub-company ADMIN/HR/management are forced to their own organization.
    const requestedOrganizationId = String(req.body.organizationId || "").trim()
    const organizationId = scope.companyWide && requestedOrganizationId
      ? requestedOrganizationId
      : req.user.organizationId

    if (!canUseOrganization(scope, organizationId)) {
      return res.status(403).json({ error: "You do not have access to this organization" })
    }

    const {
      name, address = null, latitude, longitude, radiusMeters = 250,
      timezone = null, managerId = null, geofenceMode = "WARNING", projectId = null, outsideGraceMinutes = 60,
      geofenceType = "RADIUS", boundary = [], areaSqMeters = null, perimeterMeters = null
    } = req.body

    if (!String(name || "").trim()) return res.status(400).json({ error: "Site name is required" })
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({ error: "Valid latitude and longitude are required" })
    }
    const organizationRow = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
    const resolvedTimezone = timezone ? String(timezone).trim() : (organizationRow?.timezone || "Asia/Karachi")
    if (!isValidTimeZone(resolvedTimezone)) return res.status(400).json({ error: "Invalid site timezone" })

    const radius = Math.max(25, Math.min(5000, Number(radiusMeters) || 250))
    const modes = ["STRICT", "WARNING", "DISABLED"]
    const mode = modes.includes(geofenceMode) ? geofenceMode : "WARNING"
    const normalizedBoundary = normalizeBoundary(boundary)
    const type = geofenceType === "POLYGON" && normalizedBoundary.length >= 3 ? "POLYGON" : "RADIUS"
    const center = type === "POLYGON" ? polygonCentroid(normalizedBoundary) : { lat: Number(latitude), lng: Number(longitude) }
    const grace = Math.max(5, Math.min(720, Number(outsideGraceMinutes) || 60))
    if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return res.status(400).json({ error: "A valid site location is required" })

    if (projectId) {
      const project = await prisma.project.findFirst({ where: { id: String(projectId), organizationId } })
      if (!project) return res.status(400).json({ error: "Project must belong to this organization" })
      if (isCompletedProject(project)) return res.status(400).json({ error: "Completed projects cannot have an active attendance site" })
    }

    if (managerId) {
      const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId } })
      if (!manager) return res.status(400).json({ error: "Site manager must belong to this organization" })
    }

    const siteId = id()
    await prisma.$executeRaw`
      INSERT INTO "AttendanceSite"
        ("id","organizationId","name","address","latitude","longitude","radiusMeters","timezone","managerId","geofenceMode","qrCode","projectId","outsideGraceMinutes","geofenceType","boundary","areaSqMeters","perimeterMeters")
      VALUES
        (${siteId},${organizationId},${String(name).trim()},${address},${center.lat},${center.lng},${radius},${resolvedTimezone},${managerId},${mode},${`AF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`},${projectId || null},${grace},${type},${type === "POLYGON" ? JSON.stringify(normalizedBoundary) : null}::jsonb,${type === "POLYGON" ? Number(areaSqMeters || polygonAreaSqMeters(normalizedBoundary)) : null},${type === "POLYGON" ? Number(perimeterMeters || polygonPerimeterMeters(normalizedBoundary)) : null})
    `
    const [site] = await prisma.$queryRaw`
      SELECT s.*, o.name AS "organizationName"
      FROM "AttendanceSite" s
      JOIN "Organization" o ON o.id=s."organizationId"
      WHERE s.id = ${siteId}
    `
    res.status(201).json(site)
  } catch (err) {
    console.error("[AttendanceSite.create]", err)
    if (!res.headersSent) return res.status(500).json({ error: "Could not create attendance site", detail: process.env.NODE_ENV === "production" ? undefined : err.message })
    next(err)
  }
}

async function updateSite(req, res, next) {
  try {
    if (!isManagement(req)) return res.status(403).json({ error: "Attendance site management is restricted" })

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const { id } = req.params
    const current = await prisma.$queryRaw`
      SELECT * FROM "AttendanceSite"
      WHERE id = ${id} AND "organizationId" IN (${Prisma.join(scope.organizationIds)})
    `
    if (!current.length) return res.status(404).json({ error: "Site not found" })

    const currentOrganizationId = current[0].organizationId
    const requestedOrganizationId = req.body.organizationId
    const organizationId = requestedOrganizationId || currentOrganizationId

    if (!canUseOrganization(scope, organizationId)) {
      return res.status(403).json({ error: "You do not have access to this organization" })
    }

    const b = req.body
    const fields = {
      name: b.name != null ? String(b.name).trim() : current[0].name,
      address: b.address !== undefined ? b.address : current[0].address,
      latitude: b.latitude !== undefined ? Number(b.latitude) : Number(current[0].latitude),
      longitude: b.longitude !== undefined ? Number(b.longitude) : Number(current[0].longitude),
      radiusMeters: b.radiusMeters !== undefined ? Math.max(25, Math.min(5000, Number(b.radiusMeters) || 250)) : Number(current[0].radiusMeters),
      timezone: b.timezone !== undefined ? b.timezone : current[0].timezone,
      managerId: b.managerId !== undefined ? b.managerId : current[0].managerId,
      geofenceMode: ["STRICT","WARNING","DISABLED"].includes(b.geofenceMode) ? b.geofenceMode : current[0].geofenceMode,
      projectId: b.projectId !== undefined ? (b.projectId || null) : current[0].projectId,
      outsideGraceMinutes: b.outsideGraceMinutes !== undefined ? Math.max(5, Math.min(720, Number(b.outsideGraceMinutes) || 60)) : Number(current[0].outsideGraceMinutes || 60),
      geofenceType: b.geofenceType !== undefined ? (b.geofenceType === "POLYGON" ? "POLYGON" : "RADIUS") : (current[0].geofenceType || "RADIUS"),
      boundary: b.boundary !== undefined ? normalizeBoundary(b.boundary) : normalizeBoundary(current[0].boundary),
      areaSqMeters: b.areaSqMeters !== undefined ? Number(b.areaSqMeters || 0) : Number(current[0].areaSqMeters || 0),
      perimeterMeters: b.perimeterMeters !== undefined ? Number(b.perimeterMeters || 0) : Number(current[0].perimeterMeters || 0),
      active: b.active !== undefined ? !!b.active : current[0].active,
    }
    if (!fields.name) return res.status(400).json({ error: "Site name is required" })
    if (!isValidTimeZone(fields.timezone || "Asia/Karachi")) return res.status(400).json({ error: "Invalid site timezone" })

    if (fields.projectId) {
      const project = await prisma.project.findFirst({ where: { id: String(fields.projectId), organizationId } })
      if (!project) return res.status(400).json({ error: "Project must belong to this organization" })
      if (isCompletedProject(project)) return res.status(400).json({ error: "Completed projects cannot be linked to an attendance site" })
    }

    if (fields.managerId) {
      const manager = await prisma.user.findFirst({ where: { id: fields.managerId, organizationId } })
      if (!manager) return res.status(400).json({ error: "Site manager must belong to this organization" })
    }

    const updateBoundary = fields.geofenceType === "POLYGON" && fields.boundary.length >= 3 ? fields.boundary : null
    await prisma.$executeRaw`
      UPDATE "AttendanceSite"
      SET "organizationId"=${organizationId}, "name"=${fields.name}, "address"=${fields.address},
          "latitude"=${fields.latitude}, "longitude"=${fields.longitude},
          "radiusMeters"=${fields.radiusMeters}, "timezone"=${fields.timezone},
          "managerId"=${fields.managerId}, "geofenceMode"=${fields.geofenceMode},
          "projectId"=${fields.projectId}, "outsideGraceMinutes"=${fields.outsideGraceMinutes},
          "geofenceType"=${updateBoundary ? "POLYGON" : "RADIUS"}, "boundary"=${updateBoundary ? JSON.stringify(updateBoundary) : null}::jsonb,
          "areaSqMeters"=${updateBoundary ? (fields.areaSqMeters || polygonAreaSqMeters(updateBoundary)) : null},
          "perimeterMeters"=${updateBoundary ? (fields.perimeterMeters || polygonPerimeterMeters(updateBoundary)) : null},
          "active"=${fields.active}, "updatedAt"=CURRENT_TIMESTAMP
      WHERE id=${id} AND "organizationId" IN (${Prisma.join(scope.organizationIds)})
    `
    const [site] = await prisma.$queryRaw`
      SELECT s.*, o.name AS "organizationName"
      FROM "AttendanceSite" s
      JOIN "Organization" o ON o.id=s."organizationId"
      WHERE s.id = ${id}
    `
    res.json(site)
  } catch (err) {
    next(err)
  }
}

async function assignEmployees(req, res, next) {
  try {
    if (!isManagement(req)) return res.status(403).json({ error: "Site assignment is restricted" })

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const { id } = req.params
    const site = await prisma.$queryRaw`
      SELECT id, "organizationId" FROM "AttendanceSite"
      WHERE id=${id} AND "organizationId" IN (${Prisma.join(scope.organizationIds)})
    `
    if (!site.length) return res.status(404).json({ error: "Site not found" })

    const organizationId = site[0].organizationId
    const employees = Array.isArray(req.body.employeeIds) ? req.body.employeeIds : []
    const valid = await prisma.user.findMany({
      where: { organizationId, id: { in: employees }, status: "ACTIVE" },
      select: { id: true },
    })
    const validIds = new Set(valid.map((x) => x.id))

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "AttendanceSiteEmployee" WHERE "siteId"=${id}`
      for (const employeeId of validIds) {
        await tx.$executeRaw`
          INSERT INTO "AttendanceSiteEmployee" ("siteId","employeeId","isPrimary")
          VALUES (${id},${employeeId},FALSE)
          ON CONFLICT ("siteId","employeeId") DO NOTHING
        `
      }
    })
    res.json({ siteId: id, organizationId, assigned: validIds.size })
  } catch (err) {
    next(err)
  }
}

async function verifySiteLocation(req, res, next) {
  try {
    const { siteId, latitude, longitude } = req.body
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({ error: "Valid latitude and longitude are required" })
    }

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const rows = siteId
      ? await prisma.$queryRaw`
          SELECT s.*,
            EXISTS(SELECT 1 FROM "AttendanceSiteEmployee" se WHERE se."siteId"=s.id AND se."employeeId"=${req.user.userId})
            OR EXISTS(SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${req.user.userId}) AS "assigned"
          FROM "AttendanceSite" s
          LEFT JOIN "Project" p ON p.id=s."projectId"
          WHERE s.id=${String(siteId)} AND s."organizationId" IN (${Prisma.join(scope.organizationIds)}) AND s.active=TRUE
        `
      : await prisma.$queryRaw`
          SELECT s.*,
            EXISTS(SELECT 1 FROM "AttendanceSiteEmployee" se WHERE se."siteId"=s.id AND se."employeeId"=${req.user.userId})
            OR EXISTS(SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${req.user.userId}) AS "assigned"
          FROM "AttendanceSite" s
          LEFT JOIN "Project" p ON p.id=s."projectId"
          WHERE s."organizationId" IN (${Prisma.join(scope.organizationIds)}) AND s.active=TRUE
        `
    if (!rows.length) return res.status(404).json({ error: siteId ? "Site not found" : "No active assigned site found" })

    const results = rows.map((site) => {
      const result = siteDistance(site, Number(latitude), Number(longitude))
      return {
        siteId: site.id,
        siteName: site.name,
        assigned: !!site.assigned,
        distanceMeters: Math.round(result.distance),
        radiusMeters: Number(site.radiusMeters),
        inside: result.inside,
        geofenceType: site.geofenceType || (site.boundary ? "POLYGON" : "RADIUS"),
        geofenceMode: site.geofenceMode,
        projectId: site.projectId || null,
        projectName: site.projectName || null,
      }
    }).sort((a, b) => Number(b.inside) - Number(a.inside) || a.distanceMeters - b.distanceMeters)

    const best = results[0]
    res.json({ ...best, sites: results })
  } catch (err) {
    next(err)
  }
}

async function deleteSite(req, res, next) {
  try {
    if (!isManagement(req)) {
      return res.status(403).json({ error: "Attendance site deletion is restricted" })
    }

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const { id: siteId } = req.params
    const rows = await prisma.$queryRaw`
      SELECT id, "organizationId", name
      FROM "AttendanceSite"
      WHERE id=${siteId} AND "organizationId" IN (${Prisma.join(scope.organizationIds)})
    `

    if (!rows.length) return res.status(404).json({ error: "Site not found" })

    await prisma.$transaction(async (tx) => {
      // Preserve historical attendance/presence records. Deleting a site must
      // never delete an employee's attendance history.
      await tx.$executeRaw`
        UPDATE "AttendanceRecord"
        SET "siteId" = NULL
        WHERE "siteId" = ${siteId}
      `

      // Presence events remain as audit history, but no longer point to the
      // deleted site. The FK also protects this relationship with SET NULL.
      await tx.$executeRaw`
        UPDATE "AttendancePresenceEvent"
        SET "siteId" = NULL
        WHERE "siteId" = ${siteId}
      `

      // Anomalies are historical records as well; keep them but detach the
      // deleted site reference.
      await tx.$executeRaw`
        UPDATE "AttendanceAnomaly"
        SET "siteId" = NULL
        WHERE "siteId" = ${siteId}
      `

      // Employee assignments cascade from AttendanceSite.
      await tx.$executeRaw`
        DELETE FROM "AttendanceSite"
        WHERE id = ${siteId}
          AND "organizationId" IN (${Prisma.join(scope.organizationIds)})
      `
    })

    return res.json({
      success: true,
      siteId,
      message: "Attendance site deleted successfully",
    })
  } catch (err) {
    console.error("[AttendanceSite.delete]", err)
    next(err)
  }
}

module.exports = {
  listSites,
  listAssignedSites,
  listSiteProjects,
  createSite,
  updateSite,
  assignEmployees,
  verifySiteLocation,
  deleteSite,
}
