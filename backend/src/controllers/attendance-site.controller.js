const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { distanceMeters } = require("../utils/geo")

const MANAGEMENT = ["ADMIN", "CEO", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "MANAGER"]

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

async function listSites(req, res, next) {
  try {
    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const sites = await prisma.$queryRaw`
      SELECT
        s.*,
        o.name AS "organizationName",
        u.name AS "managerName",
        COUNT(se."employeeId")::int AS "employeeCount"
      FROM "AttendanceSite" s
      JOIN "Organization" o ON o.id = s."organizationId"
      LEFT JOIN "User" u ON u.id = s."managerId"
      LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId" = s.id
      WHERE s."organizationId" IN (${prisma.join(scope.organizationIds)})
      GROUP BY s.id, o.name, u.name
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
        s."radiusMeters", s.timezone, s."geofenceMode", s."active",
        se."isPrimary"
      FROM "AttendanceSiteEmployee" se
      JOIN "AttendanceSite" s ON s.id = se."siteId"
      WHERE se."employeeId" = ${req.user.userId}
        AND s."organizationId" = ${req.user.organizationId}
        AND s.active = TRUE
      ORDER BY se."isPrimary" DESC, s.name ASC
    `
    res.json(sites)
  } catch (err) {
    next(err)
  }
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
      timezone = null, managerId = null, geofenceMode = "WARNING"
    } = req.body

    if (!String(name || "").trim()) return res.status(400).json({ error: "Site name is required" })
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({ error: "Valid latitude and longitude are required" })
    }
    const radius = Math.max(25, Math.min(5000, Number(radiusMeters) || 250))
    const modes = ["STRICT", "WARNING", "DISABLED"]
    const mode = modes.includes(geofenceMode) ? geofenceMode : "WARNING"

    if (managerId) {
      const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId } })
      if (!manager) return res.status(400).json({ error: "Site manager must belong to this organization" })
    }

    const siteId = id()
    await prisma.$executeRaw`
      INSERT INTO "AttendanceSite"
        ("id","organizationId","name","address","latitude","longitude","radiusMeters","timezone","managerId","geofenceMode","qrCode")
      VALUES
        (${siteId},${organizationId},${String(name).trim()},${address},${Number(latitude)},${Number(longitude)},${radius},${timezone},${managerId},${mode},${`AF-${crypto.randomBytes(6).toString("hex").toUpperCase()}`})
    `
    const [site] = await prisma.$queryRaw`
      SELECT s.*, o.name AS "organizationName"
      FROM "AttendanceSite" s
      JOIN "Organization" o ON o.id=s."organizationId"
      WHERE s.id = ${siteId}
    `
    res.status(201).json(site)
  } catch (err) {
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
      WHERE id = ${id} AND "organizationId" IN (${prisma.join(scope.organizationIds)})
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
      active: b.active !== undefined ? !!b.active : current[0].active,
    }
    if (!fields.name) return res.status(400).json({ error: "Site name is required" })

    if (fields.managerId) {
      const manager = await prisma.user.findFirst({ where: { id: fields.managerId, organizationId } })
      if (!manager) return res.status(400).json({ error: "Site manager must belong to this organization" })
    }

    await prisma.$executeRaw`
      UPDATE "AttendanceSite"
      SET "organizationId"=${organizationId}, "name"=${fields.name}, "address"=${fields.address},
          "latitude"=${fields.latitude}, "longitude"=${fields.longitude},
          "radiusMeters"=${fields.radiusMeters}, "timezone"=${fields.timezone},
          "managerId"=${fields.managerId}, "geofenceMode"=${fields.geofenceMode},
          "active"=${fields.active}, "updatedAt"=CURRENT_TIMESTAMP
      WHERE id=${id} AND "organizationId" IN (${prisma.join(scope.organizationIds)})
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
      WHERE id=${id} AND "organizationId" IN (${prisma.join(scope.organizationIds)})
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
    if (!siteId || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({ error: "siteId, latitude and longitude are required" })
    }

    const scope = await getOrganizationScope(req)
    if (!scope) return res.status(404).json({ error: "Organization not found" })

    const rows = await prisma.$queryRaw`
      SELECT s.*,
        EXISTS(
          SELECT 1 FROM "AttendanceSiteEmployee" se
          WHERE se."siteId"=s.id AND se."employeeId"=${req.user.userId}
        ) AS "assigned"
      FROM "AttendanceSite" s
      WHERE s.id=${siteId}
        AND s."organizationId" IN (${prisma.join(scope.organizationIds)})
        AND s.active=TRUE
    `
    if (!rows.length) return res.status(404).json({ error: "Site not found" })

    const site = rows[0]
    const distance = distanceMeters(Number(latitude), Number(longitude), Number(site.latitude), Number(site.longitude))
    const inside = distance <= Number(site.radiusMeters)
    res.json({
      siteId: site.id,
      siteName: site.name,
      assigned: !!site.assigned,
      distanceMeters: distance,
      radiusMeters: Number(site.radiusMeters),
      inside,
      geofenceMode: site.geofenceMode,
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listSites,
  listAssignedSites,
  createSite,
  updateSite,
  assignEmployees,
  verifySiteLocation,
}
