const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { encryptField, decryptField } = require("../utils/crypto")

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
    if (!["ADMIN", "CEO"].includes(role)) {
      const organization = await prisma.organization.findUnique({ where: { id: organizationId } })
      return res.json(organization ? [safeOrganization(organization)] : [])
    }

    const current = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { companyId: true },
    })
    if (!current) return res.status(404).json({ error: "Organization not found" })

    const organizations = await prisma.organization.findMany({
      where: { companyId: current.companyId, archivedAt: null },
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
    if (!["ADMIN", "CEO"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN or CEO can create organizations" })
    }

    const name = String(req.body.name || "").trim()
    if (!name) return res.status(400).json({ error: "Organization name is required" })

    const current = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, companyId: true },
    })
    if (!current) return res.status(404).json({ error: "Organization not found" })

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
    if (!["ADMIN", "CEO"].includes(role)) {
      return res.status(403).json({ error: "Only an ADMIN or CEO can remove organizations" })
    }

    const targetId = req.params.id
    const current = await prisma.organization.findFirst({
      where: { id: organizationId, archivedAt: null },
      select: { companyId: true },
    })
    if (!current) return res.status(404).json({ error: "Current organization not found" })

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

module.exports = { getOrganization, updateOrganization, listCompanyOrganizations, createSubOrganization, archiveSubOrganization }
