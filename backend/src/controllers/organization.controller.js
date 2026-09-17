const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { encryptField, decryptField } = require("../utils/crypto")
const { isValidTimeZone } = require("../utils/timezone")

function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

function safeOrganization(organization) {
  const { payrollAccountNumber: _payrollAccountNumber, ...safe } = organization
  return {
    ...safe,
    isMain: organization.id === organization.companyId,
  }
}

async function listCompanyOrganizations(req, res, next) {
  try {
    const { role, organizationId } = req.user
    const current = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        companyId: true,
        parentOrganizationId: true,
        archivedAt: true,
      },
    })

    if (!current || current.archivedAt) {
      return res.status(404).json({ error: "Organization not found" })
    }

    const isMainCompany =
      !current.parentOrganizationId &&
      (!current.companyId || current.companyId === current.id)

    // A sub-organization ADMIN must only ever see their own organization.
    // CEO and MAIN COMPANY ADMIN may see the active organizations in their company.
    const canViewCompanyOrganizations =
      role === "CEO" || (role === "ADMIN" && isMainCompany)

    if (!canViewCompanyOrganizations) {
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
      })
      return res.json(organization ? [safeOrganization(organization)] : [])
    }

    const companyId = current.companyId || current.id
    const organizations = await prisma.organization.findMany({
      where: {
        archivedAt: null,
        OR: [
          { id: companyId },
          { companyId },
        ],
      },
      orderBy: [{ parentOrganizationId: "asc" }, { name: "asc" }],
    })

    res.json(organizations.map(safeOrganization))
  } catch (err) {
    next(err)
  }
}

async function createSubOrganization(req, res, next) {
  try {
    const { organizationId, role, userId } = req.user
    if (!["ADMIN", "CEO", "MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN, CEO or MANAGER can create organizations" })
    }

    const name = String(req.body.name || "").trim()
    if (!name) return res.status(400).json({ error: "Organization name is required" })

    const current = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, companyId: true, parentOrganizationId: true, timezone: true },
    })
    if (!current) return res.status(404).json({ error: "Organization not found" })

    const isMainCompany =
      !current.parentOrganizationId &&
      (!current.companyId || current.companyId === current.id)

    if (role === "ADMIN" && !isMainCompany) {
      return res.status(403).json({
        error: "Only the main company ADMIN can create organizations",
      })
    }

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
        companyId: current.companyId,
        parentOrganizationId: current.companyId,
        timezone: current.timezone || "Asia/Karachi",
      },
    })

    logAudit({
      organizationId: current.companyId,
      actorId: userId,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      note: `${name} created under company ${current.companyId}`,
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
    if (role !== "CEO") return res.json({ ...rest, isMain: organization.id === organization.companyId })
    res.json({ ...rest, isMain: organization.id === organization.companyId, payrollAccountNumber: decryptField(payrollAccountNumber) })
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
    const { organizationId, role, userId } = req.user
    if (!["ADMIN", "CEO", "MANAGER"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN, CEO or MANAGER can remove organizations" })
    }

    const targetId = req.params.id
    const current = await prisma.organization.findFirst({
      where: { id: organizationId, archivedAt: null },
      select: { id: true, companyId: true, parentOrganizationId: true },
    })
    if (!current) return res.status(404).json({ error: "Current organization not found" })

    const isMainCompany =
      !current.parentOrganizationId &&
      (!current.companyId || current.companyId === current.id)

    if (role === "ADMIN" && !isMainCompany) {
      return res.status(403).json({
        error: "Only the main company ADMIN can remove organizations",
      })
    }

    const target = await prisma.organization.findFirst({
      where: { id: targetId, companyId: current.companyId, archivedAt: null },
      select: { id: true, name: true, companyId: true },
    })
    if (!target) return res.status(404).json({ error: "Subcompany not found" })
    if (target.id === target.companyId) {
      return res.status(400).json({ error: "The main company cannot be deleted" })
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
      organizationId: current.companyId,
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


// CEO-only: promotes an existing sub-organization to be the new main company.
// The org being promoted becomes its own root (companyId = itself,
// parentOrganizationId = null), the old main becomes its child, and every
// other org under the old company is repointed to the new companyId — all
// inside one transaction so it can never half-apply.
async function setMainCompany(req, res, next) {
  try {
    const { role, organizationId, userId } = req.user
    if (role !== "CEO") {
      return res.status(403).json({ error: "Only a CEO can change the main company" })
    }

    const targetOrganizationId = String(req.body.targetOrganizationId || "")
    if (!targetOrganizationId) {
      return res.status(400).json({ error: "targetOrganizationId is required" })
    }

    const current = await prisma.organization.findFirst({
      where: { id: organizationId, archivedAt: null },
      select: { id: true, companyId: true },
    })
    if (!current) return res.status(404).json({ error: "Organization not found" })

    const companyId = current.companyId || current.id

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

async function getOrganizationComparison(req, res, next) {
  try {
    if (!['ADMIN', 'CEO'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only ADMIN or CEO can compare organizations' })
    }

    const current = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, companyId: true, parentOrganizationId: true },
    })

    if (!current) return res.status(404).json({ error: 'Organization not found' })

    const isMainCompany =
      !current.parentOrganizationId &&
      (!current.companyId || current.companyId === current.id)

    if (req.user.role === 'ADMIN' && !isMainCompany) {
      return res.status(403).json({ error: 'Only the main company ADMIN can compare organizations' })
    }

    const companyId = current.companyId || current.id
    const organizations = await prisma.organization.findMany({
      where: {
        archivedAt: null,
        OR: [{ id: companyId }, { companyId }],
      },
      orderBy: { name: 'asc' },
    })

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
        isMain: org.id === org.companyId,
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

module.exports = { getOrganization, updateOrganization, listCompanyOrganizations, createSubOrganization, archiveSubOrganization, getOrganizationComparison, setMainCompany }
