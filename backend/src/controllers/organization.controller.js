const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { encryptField, decryptField } = require("../utils/crypto")
const { isValidTimeZone } = require("../utils/timezone")
const {
  HIERARCHY,
  HIERARCHY_SELECT,
  canAccessOrganization,
  hasCrossCompanyAccess,
  loadHomeOrganization,
  accessibleOrganizations,
  canManageHierarchy,
  hierarchyFlags,
} = require("../utils/organization")

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function safeOrganization(organization) {
  const { payrollAccountNumber: _payrollAccountNumber, ...safe } = organization
  return { ...safe, ...hierarchyFlags(organization) }
}

// Every organization the requester may access, by the hierarchy rules
// (utils/organization.js) — based on their HOME organization, never on the
// one currently selected in the switcher.
async function listCompanyOrganizations(req, res, next) {
  try {
    const { role, userId } = req.user
    const organizations = await accessibleOrganizations(prisma, { userId, role })
    if (!organizations.length) return res.status(404).json({ error: "Organization not found" })
    const full = await prisma.organization.findMany({ where: { id: { in: organizations.map((o) => o.id) } } })
    const byId = new Map(full.map((o) => [o.id, o]))
    res.json(organizations.map((o) => safeOrganization(byId.get(o.id))))
  } catch (err) {
    next(err)
  }
}

// New organizations are always CHILD companies. Allowed for a CEO, or an
// ADMIN of the Grand Parent / Parent (the roles with downward reach).
async function createSubOrganization(req, res, next) {
  try {
    const { role, userId } = req.user
    if (!["ADMIN", "CEO"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN or CEO can create organizations" })
    }

    const name = String(req.body.name || "").trim()
    if (!name) return res.status(400).json({ error: "Organization name is required" })

    const home = await loadHomeOrganization(prisma, userId)
    if (!home) return res.status(404).json({ error: "Organization not found" })
    if (!hasCrossCompanyAccess(role, home)) {
      return res.status(403).json({ error: "Only a Grand Parent or Parent company ADMIN (or a CEO) can create organizations" })
    }
    const companyId = home.companyId || home.id
    const { timezone } = (await prisma.organization.findUnique({ where: { id: home.id }, select: { timezone: true } })) || {}

    const base = slugify(name) || "organization"
    let slug = base
    let attempt = 0
    while (await prisma.organization.findUnique({ where: { slug } })) {
      attempt += 1
      slug = `${base}-${attempt}`
    }

    const organization = await prisma.organization.create({
      data: {
        name,
        slug,
        companyId,
        parentOrganizationId: companyId,
        hierarchyRole: HIERARCHY.CHILD,
        timezone: timezone || "Asia/Karachi",
      },
    })

    logAudit({
      organizationId: companyId,
      actorId: userId,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      note: `${name} created as a child company`,
    })

    res.status(201).json(safeOrganization(organization))
  } catch (err) {
    next(err)
  }
}
// The org's payroll disbursement account is sensitive, and per org policy
// only the CEO holds/sees it — salaries are paid out of the CEO's own
// account, not a shared admin one. This endpoint is hit by every logged-in
// user (Topbar branding, theme, etc.), so the account number never goes
// out to anyone but a CEO. It's encrypted at rest the same way CNIC/
// employee bank details are.
async function getOrganization(req, res, next) {
  try {
    const { organizationId, role } = req.user
    const organization = await prisma.organization.findFirst({ where: { id: organizationId, archivedAt: null } })
    if (!organization) return res.status(404).json({ error: "Organization not found" })

    const { payrollAccountNumber, ...rest } = organization
    const flags = hierarchyFlags(organization)
    if (role !== "CEO") return res.json({ ...rest, ...flags })
    res.json({ ...rest, ...flags, payrollAccountNumber: decryptField(payrollAccountNumber) })
  } catch (err) {
    next(err)
  }
}

// General settings (name/branding/leave policy) can be changed by the
// Owner (ADMIN) or a CEO — organization.routes.js gates the whole route to
// those two roles. The payroll disbursement account specifically is
// CEO-only even within that: only a CEO's account ever pays anyone, so
// only a CEO may set which account that is (checked below, not at the
// route level, since everything else on this endpoint stays open to ADMIN
// too). Renaming regenerates the slug, which is what new employees'
// suggested email addresses are built from going forward — existing
// employees keep their existing email addresses.
async function updateOrganization(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const {
      name, logoUrl, primaryColor, accentColor, theme,
      sickLeaveAllowance, casualLeaveAllowance,
      payrollBankName, payrollAccountNumber, lateDeductionAmount,
      workingHoursPerDay, workingDaysPerWeek,
      shiftStartDefault, shiftEndDefault, lateThresholdMinutes,
      timezone, breakStart, breakEnd,
      geofenceEnabled, officeLatitude, officeLongitude, geofenceRadiusMeters,
    } = req.body

    const settingPayrollAccount = payrollBankName !== undefined || payrollAccountNumber !== undefined || lateDeductionAmount !== undefined
    if (settingPayrollAccount && role !== "CEO") {
      return res.status(403).json({ error: "Only a CEO can set the payroll disbursement account" })
    }

    let slugUpdate
    if (name !== undefined && name.trim()) {
      const base = slugify(name) || "org"
      let candidate = base
      let attempt = 0
      // Guard against slug collisions across organizations.
      while (
        await prisma.organization.findFirst({
          where: { slug: candidate, NOT: { id: organizationId } },
        })
      ) {
        attempt += 1
        candidate = `${base}-${attempt}`
      }
      slugUpdate = candidate
    }

    if (sickLeaveAllowance !== undefined && (sickLeaveAllowance < 0 || sickLeaveAllowance > 365)) {
      return res.status(400).json({ error: "sickLeaveAllowance must be between 0 and 365" })
    }
    if (casualLeaveAllowance !== undefined && (casualLeaveAllowance < 0 || casualLeaveAllowance > 365)) {
      return res.status(400).json({ error: "casualLeaveAllowance must be between 0 and 365" })
    }
    let lateDeductionUpdate
    let workingHoursUpdate
    let workingDaysUpdate

    if (workingHoursPerDay !== undefined) {
      const n = Number(workingHoursPerDay)
      if (!Number.isFinite(n) || n < 1 || n > 24) {
        return res.status(400).json({ error: "workingHoursPerDay must be between 1 and 24 hours" })
      }
      workingHoursUpdate = n
    }

    if (shiftStartDefault !== undefined) {
      if (shiftStartDefault !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(shiftStartDefault))) {
        return res.status(400).json({ error: "shiftStartDefault must use HH:mm format" })
      }
    }

    if (shiftEndDefault !== undefined) {
      if (shiftEndDefault !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(shiftEndDefault))) {
        return res.status(400).json({ error: "shiftEndDefault must use HH:mm format" })
      }
    }

    if (timezone !== undefined && !isValidTimeZone(String(timezone))) {
      return res.status(400).json({ error: "timezone must be a valid IANA time zone" })
    }

    for (const [label, value] of [["breakStart", breakStart], ["breakEnd", breakEnd]]) {
      if (value !== undefined && value !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
        return res.status(400).json({ error: `${label} must use HH:mm format` })
      }
    }
    if (breakStart !== undefined && breakEnd !== undefined && breakStart && breakEnd && breakStart === breakEnd) {
      return res.status(400).json({ error: "Break start and break end cannot be the same" })
    }

    if (lateThresholdMinutes !== undefined) {
      const n = Number(lateThresholdMinutes)
      if (!Number.isFinite(n) || n < 0 || n > 24 * 60) {
        return res.status(400).json({ error: "lateThresholdMinutes must be a number of minutes between 0 and 1440" })
      }
    }

    if (workingDaysPerWeek !== undefined) {
      const n = Number(workingDaysPerWeek)
      if (!Number.isInteger(n) || n < 1 || n > 7) {
        return res.status(400).json({ error: "workingDaysPerWeek must be an integer between 1 and 7" })
      }
      workingDaysUpdate = n
    }
    if (lateDeductionAmount !== undefined) {
      const n = Number(lateDeductionAmount)
      if (Number.isNaN(n) || n < 0) {
        return res.status(400).json({ error: "lateDeductionAmount must be a non-negative number" })
      }
      lateDeductionUpdate = n
    }

    let officeLatUpdate
    let officeLngUpdate
    if (officeLatitude !== undefined) {
      officeLatUpdate = officeLatitude === null || officeLatitude === "" ? null : Number(officeLatitude)
      if (officeLatUpdate !== null && (Number.isNaN(officeLatUpdate) || officeLatUpdate < -90 || officeLatUpdate > 90)) {
        return res.status(400).json({ error: "officeLatitude must be between -90 and 90" })
      }
    }
    if (officeLongitude !== undefined) {
      officeLngUpdate = officeLongitude === null || officeLongitude === "" ? null : Number(officeLongitude)
      if (officeLngUpdate !== null && (Number.isNaN(officeLngUpdate) || officeLngUpdate < -180 || officeLngUpdate > 180)) {
        return res.status(400).json({ error: "officeLongitude must be between -180 and 180" })
      }
    }
    let geofenceRadiusUpdate
    if (geofenceRadiusMeters !== undefined) {
      const n = parseInt(geofenceRadiusMeters, 10)
      if (!Number.isFinite(n) || n < 20 || n > 20000) {
        return res.status(400).json({ error: "geofenceRadiusMeters must be between 20 and 20000" })
      }
      geofenceRadiusUpdate = n
    }

    const before = await prisma.organization.findUnique({ where: { id: organizationId } })

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(slugUpdate ? { slug: slugUpdate } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(primaryColor !== undefined ? { primaryColor } : {}),
        ...(accentColor !== undefined ? { accentColor } : {}),
        ...(theme !== undefined ? { theme } : {}),
        ...(sickLeaveAllowance !== undefined ? { sickLeaveAllowance: parseInt(sickLeaveAllowance, 10) } : {}),
        ...(casualLeaveAllowance !== undefined ? { casualLeaveAllowance: parseInt(casualLeaveAllowance, 10) } : {}),
        ...(payrollBankName !== undefined ? { payrollBankName } : {}),
        ...(payrollAccountNumber !== undefined ? { payrollAccountNumber: encryptField(payrollAccountNumber) } : {}),
        ...(lateDeductionUpdate !== undefined ? { lateDeductionAmount: lateDeductionUpdate } : {}),
        ...(workingHoursUpdate !== undefined ? { workingHoursPerDay: workingHoursUpdate } : {}),
        ...(workingDaysUpdate !== undefined ? { workingDaysPerWeek: workingDaysUpdate } : {}),
        ...(shiftStartDefault !== undefined ? { shiftStartDefault } : {}),
        ...(shiftEndDefault !== undefined ? { shiftEndDefault } : {}),
        ...(lateThresholdMinutes !== undefined ? { lateThresholdMinutes: Number(lateThresholdMinutes) } : {}),
        ...(timezone !== undefined ? { timezone: String(timezone) } : {}),
        ...(breakStart !== undefined ? { breakStart: breakStart || null } : {}),
        ...(breakEnd !== undefined ? { breakEnd: breakEnd || null } : {}),
        ...(geofenceEnabled !== undefined ? { geofenceEnabled: !!geofenceEnabled } : {}),
        ...(officeLatUpdate !== undefined ? { officeLatitude: officeLatUpdate } : {}),
        ...(officeLngUpdate !== undefined ? { officeLongitude: officeLngUpdate } : {}),
        ...(geofenceRadiusUpdate !== undefined ? { geofenceRadiusMeters: geofenceRadiusUpdate } : {}),
      },
    })

    if (before?.name !== updated.name) {
      logAudit({ organizationId, actorId: userId, action: "organization.renamed", targetType: "Organization", targetId: organizationId, note: `${before?.name} -> ${updated.name}` })
    }

    const { payrollAccountNumber: _omit, ...safeUpdated } = updated
    if (role === "CEO") {
      return res.json({ ...safeUpdated, payrollAccountNumber: decryptField(updated.payrollAccountNumber) })
    }
    res.json(safeUpdated)
  } catch (err) {
    next(err)
  }
}


async function archiveSubOrganization(req, res, next) {
  try {
    const { role, userId } = req.user
    if (!["ADMIN", "CEO"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN or CEO can remove organizations" })
    }

    const home = await loadHomeOrganization(prisma, userId)
    if (!home) return res.status(404).json({ error: "Current organization not found" })

    const target = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { ...HIERARCHY_SELECT, name: true },
    })
    // Same 403 as the switcher for anything outside the requester's reach.
    if (!target || target.id === home.id || !canAccessOrganization(role, home, target)) {
      return res.status(403).json({ error: "You do not have access to this organization" })
    }
    if (target.hierarchyRole === HIERARCHY.GRAND_PARENT) {
      return res.status(400).json({ error: "The Grand Parent company cannot be removed" })
    }
    if (target.hierarchyRole === HIERARCHY.PARENT) {
      return res.status(400).json({ error: "This is the Parent company — the Grand Parent CEO must change the hierarchy first" })
    }

    // Keep historical payroll, attendance, projects and audit data intact.
    // Archiving removes the organization from all active company selectors
    // while preserving the records for audit/history.
    const archivedAt = new Date()
    await prisma.organization.update({
      where: { id: target.id },
      data: { archivedAt },
    })

    logAudit({
      organizationId: target.companyId || target.id,
      actorId: userId,
      action: "organization.archived",
      targetType: "Organization",
      targetId: target.id,
      note: `${target.name} removed from the company`,
    })

    res.json({ message: "Subcompany removed", organizationId: target.id, archivedAt })
  } catch (err) {
    next(err)
  }
}


// Grand Parent CEO only: re-roots the company group's internal id (companyId)
// onto another organization. Doesn't change anyone's access — that's the
// hierarchy (setCompanyHierarchy) — and is kept for back-compat.
async function setMainCompany(req, res, next) {
  try {
    const { role, userId } = req.user
    const home = await loadHomeOrganization(prisma, userId)
    if (!canManageHierarchy(role, home)) {
      return res.status(403).json({ error: "Only the Grand Parent company's CEO can change this" })
    }

    const targetOrganizationId = String(req.body.targetOrganizationId || "")
    if (!targetOrganizationId) {
      return res.status(400).json({ error: "targetOrganizationId is required" })
    }

    const companyId = home.companyId || home.id

    const target = await prisma.organization.findFirst({
      where: { id: targetOrganizationId, companyId, archivedAt: null },
    })
    if (!target) {
      return res.status(404).json({ error: "Target must be an active organization within the same company" })
    }
    if (target.id === companyId) {
      return res.status(400).json({ error: "That organization is already the main company" })
    }

    await prisma.$transaction([
      prisma.organization.updateMany({
        where: { companyId },
        data: { companyId: target.id },
      }),
      prisma.organization.update({
        where: { id: target.id },
        data: { companyId: target.id, parentOrganizationId: null },
      }),
      prisma.organization.update({
        where: { id: companyId },
        data: { parentOrganizationId: target.id },
      }),
    ])

    logAudit({
      organizationId: target.id,
      actorId: userId,
      action: "organization.main_company_changed",
      targetType: "Organization",
      targetId: target.id,
      note: `${target.name} promoted to main company (previously ${companyId})`,
    })

    res.json({ newMainCompanyId: target.id })
  } catch (err) {
    next(err)
  }
}

// Grand Parent CEO only: designate which company is the Grand Parent and
// which is the Parent. Body: { grandParentId, parentId } (parentId may be
// null = no Parent). Everything else in the group becomes a Child.
// Rules: both must be active organizations of the requester's own company
// group; they must differ; the new Grand Parent must have an active CEO (so
// the hierarchy can never be left with nobody able to manage it). Each
// designation is unique per group (also a DB partial unique index).
async function setCompanyHierarchy(req, res, next) {
  try {
    const { role, userId } = req.user
    const home = await loadHomeOrganization(prisma, userId)
    if (!canManageHierarchy(role, home)) {
      return res.status(403).json({ error: "Only the Grand Parent company's CEO can change the company hierarchy" })
    }
    const companyId = home.companyId || home.id

    const grandParentId = String(req.body.grandParentId || "").trim()
    const parentId = req.body.parentId ? String(req.body.parentId).trim() : null
    if (!grandParentId) return res.status(400).json({ error: "grandParentId is required" })
    if (parentId && parentId === grandParentId) {
      return res.status(400).json({ error: "A company cannot be both the Grand Parent and the Parent" })
    }

    const ids = [grandParentId, ...(parentId ? [parentId] : [])]
    const targets = await prisma.organization.findMany({
      where: { id: { in: ids }, archivedAt: null, OR: [{ id: companyId }, { companyId }] },
      select: { id: true, name: true },
    })
    if (targets.length !== ids.length) {
      return res.status(404).json({ error: "Pick active organizations from your own company group" })
    }

    const gpCeo = await prisma.user.count({ where: { organizationId: grandParentId, role: "CEO", status: { not: "LEFT_COMPANY" } } })
    if (!gpCeo) {
      return res.status(400).json({ error: "The Grand Parent company must have an active CEO (only they can manage the hierarchy)" })
    }

    const before = await prisma.organization.findMany({
      where: { OR: [{ id: companyId }, { companyId }], hierarchyRole: { in: [HIERARCHY.GRAND_PARENT, HIERARCHY.PARENT] } },
      select: { id: true, name: true, hierarchyRole: true },
    })

    const group = { OR: [{ id: companyId }, { companyId }] }
    await prisma.$transaction([
      // Demote first so the one-per-group unique indexes never collide.
      prisma.organization.updateMany({ where: { ...group, hierarchyRole: { not: HIERARCHY.CHILD } }, data: { hierarchyRole: HIERARCHY.CHILD } }),
      prisma.organization.update({ where: { id: grandParentId }, data: { hierarchyRole: HIERARCHY.GRAND_PARENT } }),
      ...(parentId ? [prisma.organization.update({ where: { id: parentId }, data: { hierarchyRole: HIERARCHY.PARENT } })] : []),
    ])

    const name = (id) => targets.find((t) => t.id === id)?.name
    const was = (r) => before.find((b) => b.hierarchyRole === r)?.name || "none"
    logAudit({
      organizationId: companyId,
      actorId: userId,
      action: "organization.hierarchy_changed",
      targetType: "Organization",
      targetId: grandParentId,
      note: `Grand Parent: ${name(grandParentId)} (was ${was(HIERARCHY.GRAND_PARENT)}); Parent: ${parentId ? name(parentId) : "none"} (was ${was(HIERARCHY.PARENT)})`,
    })

    res.json({ grandParentId, parentId })
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "The hierarchy was changed at the same time — refresh and try again" })
    next(err)
  }
}
async function getOrganizationComparison(req, res, next) {
  try {
    if (!['ADMIN', 'CEO'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only ADMIN or CEO can compare organizations' })
    }

    // Only the organizations this user may access (hierarchy rules), never
    // the whole group — a Parent ADMIN doesn't get the Grand Parent's numbers.
    const organizations = await accessibleOrganizations(prisma, { userId: req.user.userId, role: req.user.role })
    if (!organizations.length) return res.status(404).json({ error: 'Organization not found' })

    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)
    const monthStart = new Date(now)
    monthStart.setDate(monthStart.getDate() - 30)

    const rows = await Promise.all(organizations.map(async (org) => {
      const [
        employees,
        presentToday,
        assets,
        assignedAssets,
        activeProjects,
        completedProjects,
        monthAttendance,
        departments,
      ] = await Promise.all([
        prisma.user.count({
          where: { organizationId: org.id, status: 'ACTIVE' },
        }),
        prisma.attendanceRecord.count({
          where: {
            organizationId: org.id,
            date: { gte: todayStart, lte: todayEnd },
            status: 'PRESENT',
          },
        }),
        prisma.asset.count({
          where: { organizationId: org.id },
        }),
        prisma.asset.count({
          where: { organizationId: org.id, status: 'ASSIGNED' },
        }),
        prisma.project.count({
          where: { organizationId: org.id, status: 'IN_PROGRESS' },
        }),
        prisma.project.count({
          where: { organizationId: org.id, status: 'COMPLETED' },
        }),
        prisma.attendanceRecord.findMany({
          where: {
            organizationId: org.id,
            date: { gte: monthStart },
          },
          select: { status: true },
        }),
        prisma.department.count({
          where: { organizationId: org.id },
        }),
      ])

      const attendanceRate = monthAttendance.length
        ? Math.round(
            (monthAttendance.filter((item) => item.status === 'PRESENT').length /
              monthAttendance.length) *
              100
          )
        : 0

      return {
        id: org.id,
        name: org.name,
        ...hierarchyFlags(org),
        employees,
        presentToday,
        assets,
        assignedAssets,
        utilizationRate: assets
          ? Math.round((assignedAssets / assets) * 100)
          : 0,
        activeProjects,
        completedProjects,
        departments,
        attendanceRate,
      }
    }))

    return res.json(rows)
  } catch (err) {
    next(err)
  }
}

module.exports = { getOrganization, updateOrganization, listCompanyOrganizations, createSubOrganization, archiveSubOrganization, getOrganizationComparison, setMainCompany, setCompanyHierarchy }
