const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { encryptField, decryptField } = require("../utils/crypto")
const { isValidTimeZone } = require("../utils/timezone")
const {
  ORG_ACCESS_SELECT,
  GRANTABLE_ROLES,
  canAccessOrganization,
  loadHomeOrganization,
  accessibleOrganizations,
  canManageCompanies,
} = require("../utils/organization")
const { toDateOnly } = require("../utils/date")

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function safeOrganization(organization) {
  const { payrollAccountNumber: _payrollAccountNumber, ...safe } = organization
  return safe
}

// Every organization the requester may access (utils/organization.js) —
// based on their HOME organization, never on the one currently selected in
// the switcher.
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

// CEO only: add a company to the CEO's group. All companies are equal; no
// one but CEOs can open it until a CEO gives them access.
async function createSubOrganization(req, res, next) {
  try {
    const { role, userId } = req.user
    if (!canManageCompanies(role)) {
      return res.status(403).json({ error: "Only a CEO can add companies" })
    }

    const name = String(req.body.name || "").trim()
    if (!name) return res.status(400).json({ error: "Company name is required" })

    const home = await loadHomeOrganization(prisma, userId)
    if (!home) return res.status(404).json({ error: "Organization not found" })
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
        timezone: timezone || "Asia/Karachi",
      },
    })

    logAudit({
      organizationId: companyId,
      actorId: userId,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      note: `${name} added`,
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
    if (role !== "CEO") return res.json(rest)
    res.json({ ...rest, payrollAccountNumber: decryptField(payrollAccountNumber) })
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
      sickLeaveAllowance, casualLeaveAllowance, annualLeaveEntitlement,
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
    if (annualLeaveEntitlement !== undefined && (!Number.isInteger(Number(annualLeaveEntitlement)) || annualLeaveEntitlement < 0 || annualLeaveEntitlement > 365)) {
      return res.status(400).json({ error: "Total paid leave must be a whole number between 0 and 365" })
    }
    // Sick + casual come out of the yearly pool; annual leave is the rest.
    if (sickLeaveAllowance !== undefined || casualLeaveAllowance !== undefined || annualLeaveEntitlement !== undefined) {
      const current = await prisma.organization.findUnique({ where: { id: organizationId }, select: { sickLeaveAllowance: true, casualLeaveAllowance: true, annualLeaveEntitlement: true } })
      const total = Number(annualLeaveEntitlement ?? current.annualLeaveEntitlement)
      const parts = Number(sickLeaveAllowance ?? current.sickLeaveAllowance) + Number(casualLeaveAllowance ?? current.casualLeaveAllowance)
      if (parts > total) {
        return res.status(400).json({ error: `Sick + casual leave (${parts}) can't be more than the total paid leave (${total})` })
      }
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
        ...(annualLeaveEntitlement !== undefined ? { annualLeaveEntitlement: parseInt(annualLeaveEntitlement, 10) } : {}),
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


// CEO only: remove (archive) a company. History is kept; it just disappears
// from every selector. A CEO can't remove their own company.
async function archiveSubOrganization(req, res, next) {
  try {
    const { role, userId } = req.user
    if (!canManageCompanies(role)) {
      return res.status(403).json({ error: "Only a CEO can remove companies" })
    }

    const home = await loadHomeOrganization(prisma, userId)
    if (!home) return res.status(404).json({ error: "Current organization not found" })

    const target = await prisma.organization.findUnique({
      where: { id: req.params.id },
      select: { ...ORG_ACCESS_SELECT, name: true },
    })
    if (!target || !canAccessOrganization(role, home, target)) {
      return res.status(403).json({ error: "You do not have access to this organization" })
    }
    if (target.id === home.id) {
      return res.status(400).json({ error: "You can't remove your own company" })
    }

    // Keep historical payroll, attendance, projects and audit data intact.
    const archivedAt = new Date()
    await prisma.$transaction([
      prisma.organization.update({ where: { id: target.id }, data: { archivedAt } }),
      prisma.organizationAccessGrant.deleteMany({ where: { organizationId: target.id } }),
    ])

    logAudit({
      organizationId: target.companyId || target.id,
      actorId: userId,
      action: "organization.archived",
      targetType: "Organization",
      targetId: target.id,
      note: `${target.name} removed`,
    })

    res.json({ message: "Company removed", organizationId: target.id, archivedAt })
  } catch (err) {
    next(err)
  }
}

// CEO only (route): every ADMIN and IT_MANAGER of the CEO's group, with the
// companies a CEO gave them — feeds the "Give access" pickers in Settings.
async function listAccessUsers(req, res, next) {
  try {
    const { role, userId } = req.user
    const orgIds = (await accessibleOrganizations(prisma, { userId, role })).map((o) => o.id)
    const users = await prisma.user.findMany({
      where: { organizationId: { in: orgIds }, role: { in: GRANTABLE_ROLES }, status: { not: "LEFT_COMPANY" } },
      select: {
        id: true, name: true, email: true, role: true,
        organization: { select: { id: true, name: true } },
        accessGrants: { select: { organizationId: true } },
      },
      orderBy: { name: "asc" },
    })
    res.json(users.map(({ accessGrants, ...u }) => ({ ...u, grantedOrganizationIds: accessGrants.map((g) => g.organizationId) })))
  } catch (err) {
    next(err)
  }
}

// CEO only (route): give an ADMIN / IT_MANAGER of the CEO's group access to
// one company. Body: { userId }.
async function grantOrganizationAccess(req, res, next) {
  try {
    const { role, userId } = req.user
    const orgs = await accessibleOrganizations(prisma, { userId, role })
    const target = orgs.find((o) => o.id === req.params.id)
    if (!target) return res.status(404).json({ error: "Organization not found" })

    const grantee = await prisma.user.findFirst({
      where: { id: String(req.body.userId || ""), organizationId: { in: orgs.map((o) => o.id) }, status: { not: "LEFT_COMPANY" } },
      select: { id: true, name: true, role: true, organizationId: true },
    })
    if (!grantee) return res.status(404).json({ error: "User not found" })
    if (!GRANTABLE_ROLES.includes(grantee.role)) {
      return res.status(400).json({ error: "Only an Admin or IT Manager can be given company access" })
    }
    if (grantee.organizationId === target.id) {
      return res.status(400).json({ error: `${grantee.name} already belongs to ${target.name}` })
    }

    await prisma.organizationAccessGrant.upsert({
      where: { userId_organizationId: { userId: grantee.id, organizationId: target.id } },
      update: {},
      create: { userId: grantee.id, organizationId: target.id, grantedById: userId },
    })
    logAudit({
      organizationId: target.companyId || target.id,
      actorId: userId,
      action: "organization.access_granted",
      targetType: "User",
      targetId: grantee.id,
      note: `${grantee.name} given access to ${target.name}`,
    })
    res.status(201).json({ userId: grantee.id, organizationId: target.id })
  } catch (err) {
    next(err)
  }
}

// CEO only (route): take that access away again.
async function revokeOrganizationAccess(req, res, next) {
  try {
    const { role, userId } = req.user
    const orgs = await accessibleOrganizations(prisma, { userId, role })
    const target = orgs.find((o) => o.id === req.params.id)
    if (!target) return res.status(404).json({ error: "Organization not found" })

    const { count } = await prisma.organizationAccessGrant.deleteMany({ where: { organizationId: target.id, userId: req.params.userId } })
    if (count) {
      logAudit({
        organizationId: target.companyId || target.id,
        actorId: userId,
        action: "organization.access_revoked",
        targetType: "User",
        targetId: req.params.userId,
        note: `Access to ${target.name} removed`,
      })
    }
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

// Today's date in an organization's own timezone, as the UTC-midnight Date
// attendance records are stored under.
function orgToday(timezone) {
  let key
  try {
    key = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Karachi" }).format(new Date())
  } catch {
    key = new Date().toISOString().slice(0, 10)
  }
  return toDateOnly(key)
}

// Per-company numbers for every company the requester may access (CEO: all
// of them). Used by Organization Comparison and the CEO dashboard's
// "All companies" overview.
async function getOrganizationComparison(req, res, next) {
  try {
    if (!["ADMIN", "CEO"].includes(req.user.role)) {
      return res.status(403).json({ error: "Only ADMIN or CEO can compare organizations" })
    }

    const organizations = await accessibleOrganizations(prisma, { userId: req.user.userId, role: req.user.role, select: { timezone: true } })
    if (!organizations.length) return res.status(404).json({ error: "Organization not found" })

    const monthStart = new Date()
    monthStart.setUTCDate(monthStart.getUTCDate() - 30)

    const rows = await Promise.all(organizations.map(async (org) => {
      const today = orgToday(org.timezone)
      const tomorrow = new Date(today)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const onDay = { organizationId: org.id, date: { gte: today, lt: tomorrow } }

      const [employees, todayByStatus, assets, assignedAssets, activeProjects, completedProjects, monthByStatus, departments, openTickets, pendingLeave] = await Promise.all([
        prisma.user.count({ where: { organizationId: org.id, status: "ACTIVE" } }),
        // Active employees only — the same roster the Attendance page lists, so
        // the dashboard tiles match the filtered lists they link to.
        prisma.attendanceRecord.groupBy({ by: ["status"], where: { ...onDay, employee: { status: "ACTIVE" } }, _count: { _all: true } }),
        prisma.asset.count({ where: { organizationId: org.id } }),
        prisma.asset.count({ where: { organizationId: org.id, status: "ASSIGNED" } }),
        prisma.project.count({ where: { organizationId: org.id, status: "IN_PROGRESS" } }),
        prisma.project.count({ where: { organizationId: org.id, status: "COMPLETED" } }),
        prisma.attendanceRecord.groupBy({ by: ["status"], where: { organizationId: org.id, date: { gte: toDateOnly(monthStart) } }, _count: { _all: true } }),
        prisma.department.count({ where: { organizationId: org.id } }),
        prisma.ticket.count({ where: { organizationId: org.id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        prisma.leaveApplication.count({ where: { organizationId: org.id, status: { in: ["PENDING_HR", "PENDING_FINAL_APPROVAL"] } } }),
      ])

      const count = (groups, status) => groups.find((g) => g.status === status)?._count._all || 0
      const lateToday = count(todayByStatus, "LATE")
      const presentToday = count(todayByStatus, "PRESENT") + lateToday
      const absentToday = count(todayByStatus, "ABSENT")
      const onLeaveToday = count(todayByStatus, "LEAVE")
      const monthTotal = monthByStatus.reduce((sum, g) => sum + g._count._all, 0)
      const monthPresent = count(monthByStatus, "PRESENT") + count(monthByStatus, "LATE")

      return {
        id: org.id,
        name: org.name,
        isHome: org.id === req.user.homeOrganizationId,
        employees,
        presentToday,
        lateToday,
        absentToday,
        onLeaveToday,
        notMarkedToday: Math.max(0, employees - presentToday - absentToday - onLeaveToday),
        assets,
        assignedAssets,
        utilizationRate: assets ? Math.round((assignedAssets / assets) * 100) : 0,
        activeProjects,
        completedProjects,
        departments,
        openTickets,
        pendingLeave,
        attendanceRate: monthTotal ? Math.round((monthPresent / monthTotal) * 100) : 0,
      }
    }))

    return res.json(rows)
  } catch (err) {
    next(err)
  }
}

module.exports = { getOrganization, updateOrganization, listCompanyOrganizations, createSubOrganization, archiveSubOrganization, getOrganizationComparison, listAccessUsers, grantOrganizationAccess, revokeOrganizationAccess }
