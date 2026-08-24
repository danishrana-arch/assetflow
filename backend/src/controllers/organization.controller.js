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

// The org's payroll disbursement account is sensitive, and per org policy
// only the CEO holds/sees it — salaries are paid out of the CEO's own
// account, not a shared admin one. This endpoint is hit by every logged-in
// user (Topbar branding, theme, etc.), so the account number never goes
// out to anyone but a CEO. It's encrypted at rest the same way CNIC/
// employee bank details are.
async function getOrganization(req, res, next) {
  try {
    const { organizationId, role } = req.user
    const organization = await prisma.organization.findUnique({ where: { id: organizationId } })
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
      sickLeaveAllowance, casualLeaveAllowance,
      payrollBankName, payrollAccountNumber, lateDeductionAmount,
      workingHoursPerDay, workingDaysPerWeek,
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

module.exports = { getOrganization, updateOrganization }
