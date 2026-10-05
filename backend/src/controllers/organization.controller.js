const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { encryptField, decryptField } = require("../utils/crypto")
const { isValidTimeZone } = require("../utils/timezone")
const {
  HIERARCHY,
  OFFICE_TYPE,
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
    res.json(organizations.map((o) => ({ ...safeOrganization(byId.get(o.id)), depth: o.depth })))
  } catch (err) {
    next(err)
  }
}

// New organizations are always CHILD companies, placed under a Grand Parent
// or Parent the requester can access (`parentOrganizationId` in the body;
// defaults to their home company if it's a Grand Parent / Parent, else the
// first accessible one). Allowed for a CEO, or an ADMIN of a Grand Parent /
// Parent (the roles with downward reach). The Grand Parent CEO can then
// promote it in the hierarchy editor.
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

    // "NONE" (CEO only) = a new Grand Parent with nothing above it.
    const requestedParentId = req.body.parentOrganizationId ? String(req.body.parentOrganizationId) : ""
    const newGrandParent = requestedParentId === "NONE"
    if (newGrandParent && role !== "CEO") {
      return res.status(403).json({ error: "Only a CEO can add a new Grand Parent company" })
    }

    // Hierarchy reach only — CEO grants / call-center access never let an admin create companies.
    const reachable = (await accessibleOrganizations(prisma, { role, home, access: { callCenterAccess: false, grantedOrganizationIds: [] } })).filter((o) => o.hierarchyRole !== HIERARCHY.CHILD)
    const parent = newGrandParent
      ? null
      : requestedParentId
        ? reachable.find((o) => o.id === requestedParentId)
        : reachable.find((o) => o.id === home.id) || reachable[0]
    if (!newGrandParent && !parent) {
      return res.status(requestedParentId ? 403 : 400).json({ error: "Pick a Grand Parent or Parent company you can access to place the new company under" })
    }
    // Level follows position: under a Grand Parent = Parent, under a Parent = Child.
    const hierarchyRole = newGrandParent
      ? HIERARCHY.GRAND_PARENT
      : parent.hierarchyRole === HIERARCHY.GRAND_PARENT ? HIERARCHY.PARENT : HIERARCHY.CHILD
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
        parentOrganizationId: parent ? parent.id : null,
        hierarchyRole,
        timezone: timezone || "Asia/Karachi",
      },
    })

    logAudit({
      organizationId: companyId,
      actorId: userId,
      action: "organization.created",
      targetType: "Organization",
      targetId: organization.id,
      note: parent ? `${name} created under ${parent.name}` : `${name} created as a Grand Parent company`,
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
      return res.status(400).json({ error: "A Grand Parent company cannot be removed — a CEO must place it under another company first" })
    }
    const below = await prisma.organization.count({ where: { parentOrganizationId: target.id, archivedAt: null } })
    if (below) {
      return res.status(400).json({ error: "Move the companies under it somewhere else first" })
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

    // Only the group id moves; parentOrganizationId is the hierarchy tree
    // and is left alone.
    await prisma.organization.updateMany({
      where: { OR: [{ id: companyId }, { companyId }] },
      data: { companyId: target.id },
    })

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

// CEO only: set the whole company tree in one go.
// Body: { organizations: [{ id, hierarchyRole, parentOrganizationId }] } —
// one entry for EVERY active organization of the requester's company group.
// Rules: a Grand Parent has no parent; a Parent sits under a Grand Parent;
// a Child sits under a Grand Parent or a Parent (so max three levels, no
// cycles); at least one Grand Parent.
async function setCompanyHierarchy(req, res, next) {
  try {
    const { role, userId } = req.user
    const home = await loadHomeOrganization(prisma, userId)
    if (!canManageHierarchy(role, home)) {
      return res.status(403).json({ error: "Only a CEO can change the company hierarchy" })
    }
    const companyId = home.companyId || home.id
    const group = { OR: [{ id: companyId }, { companyId }] }

    const entries = Array.isArray(req.body.organizations) ? req.body.organizations : null
    if (!entries) return res.status(400).json({ error: "organizations must be a list" })

    const active = await prisma.organization.findMany({
      where: { ...group, archivedAt: null },
      select: { id: true, name: true, hierarchyRole: true, parentOrganizationId: true },
    })
    const activeById = new Map(active.map((o) => [o.id, o]))

    const plan = new Map()
    for (const entry of entries) {
      const id = String(entry?.id || "")
      const hierarchyRole = String(entry?.hierarchyRole || "")
      const parentOrganizationId = entry?.parentOrganizationId ? String(entry.parentOrganizationId) : null
      if (!activeById.has(id)) return res.status(404).json({ error: "Pick active organizations from your own company group" })
      if (plan.has(id)) return res.status(400).json({ error: "Each company can appear only once" })
      if (!HIERARCHY[hierarchyRole]) return res.status(400).json({ error: "Level must be Grand Parent, Parent or Child" })
      plan.set(id, { id, hierarchyRole, parentOrganizationId })
    }
    if (plan.size !== active.length) {
      return res.status(400).json({ error: "Every company in the group must be included — refresh and try again" })
    }

    const nameOf = (id) => activeById.get(id)?.name || "?"
    for (const org of plan.values()) {
      const parent = org.parentOrganizationId ? plan.get(org.parentOrganizationId) : null
      if (org.hierarchyRole === HIERARCHY.GRAND_PARENT) {
        if (org.parentOrganizationId) return res.status(400).json({ error: `${nameOf(org.id)} is a Grand Parent, so it can't sit under another company` })
      } else if (org.hierarchyRole === HIERARCHY.PARENT) {
        if (!parent || parent.hierarchyRole !== HIERARCHY.GRAND_PARENT) {
          return res.status(400).json({ error: `${nameOf(org.id)} is a Parent, so it must sit under a Grand Parent` })
        }
      } else if (!parent || parent.hierarchyRole === HIERARCHY.CHILD) {
        return res.status(400).json({ error: `${nameOf(org.id)} is a Child, so it must sit under a Grand Parent or a Parent` })
      }
    }

    const grandParentIds = [...plan.values()].filter((o) => o.hierarchyRole === HIERARCHY.GRAND_PARENT).map((o) => o.id)
    if (!grandParentIds.length) return res.status(400).json({ error: "At least one company must be a Grand Parent" })

    const changed = [...plan.values()].filter((o) => {
      const was = activeById.get(o.id)
      return was.hierarchyRole !== o.hierarchyRole || (was.parentOrganizationId || null) !== o.parentOrganizationId
    })
    if (changed.length) {
      await prisma.$transaction(changed.map((o) => prisma.organization.update({
        where: { id: o.id },
        data: { hierarchyRole: o.hierarchyRole, parentOrganizationId: o.parentOrganizationId },
      })))
    }

    const LABEL = { GRAND_PARENT: "Grand Parent", PARENT: "Parent", CHILD: "Child" }
    if (changed.length) {
      logAudit({
        organizationId: companyId,
        actorId: userId,
        action: "organization.hierarchy_changed",
        targetType: "Organization",
        targetId: companyId,
        note: changed
          .map((o) => {
            const was = activeById.get(o.id)
            const under = o.parentOrganizationId ? ` under ${nameOf(o.parentOrganizationId)}` : ""
            const wasUnder = was.parentOrganizationId && activeById.has(was.parentOrganizationId) ? ` under ${nameOf(was.parentOrganizationId)}` : ""
            return `${nameOf(o.id)}: ${LABEL[o.hierarchyRole]}${under} (was ${LABEL[was.hierarchyRole] || "Child"}${wasUnder})`
          })
          .join("; ")
          .slice(0, 1900),
      })
    }

    res.json({ updated: changed.length })
  } catch (err) {
    next(err)
  }
}
// CEO only (route): mark a company of the CEO's group as an IT office or a
// call center. Body: { officeType: "IT_OFFICE" | "CALL_CENTER" }.
async function setOfficeType(req, res, next) {
  try {
    const { role, userId } = req.user
    const officeType = String(req.body.officeType || "")
    if (!OFFICE_TYPE[officeType]) return res.status(400).json({ error: "officeType must be IT_OFFICE or CALL_CENTER" })

    const reachable = await accessibleOrganizations(prisma, { userId, role })
    const target = reachable.find((o) => o.id === req.params.id)
    if (!target) return res.status(404).json({ error: "Organization not found" })

    if (target.officeType !== officeType) {
      await prisma.organization.update({ where: { id: target.id }, data: { officeType } })
      logAudit({
        organizationId: target.companyId || target.id,
        actorId: userId,
        action: "organization.office_type_changed",
        targetType: "Organization",
        targetId: target.id,
        note: `${target.name}: ${officeType === "CALL_CENTER" ? "Call center" : "IT office"}`,
      })
    }
    res.json({ id: target.id, officeType })
  } catch (err) {
    next(err)
  }
}

// CEO only (route): every ADMIN and IT_MANAGER in the CEO's company group,
// with their call-center flag and the companies a CEO granted them.
async function listCallCenterAdmins(req, res, next) {
  try {
    const { role, userId } = req.user
    const orgIds = (await accessibleOrganizations(prisma, { userId, role })).map((o) => o.id)
    const users = await prisma.user.findMany({
      where: { organizationId: { in: orgIds }, role: { in: ["ADMIN", "IT_MANAGER"] }, status: { not: "LEFT_COMPANY" } },
      select: {
        id: true, name: true, email: true, role: true, callCenterAccess: true,
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
    if (!["ADMIN", "IT_MANAGER"].includes(grantee.role)) {
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

// CEO only (route): give / take an ADMIN's access to every call center.
// Body: { enabled: boolean }.
async function setCallCenterAccess(req, res, next) {
  try {
    const { role, userId } = req.user
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" })
    const enabled = req.body.enabled

    const orgIds = (await accessibleOrganizations(prisma, { userId, role })).map((o) => o.id)
    const target = await prisma.user.findFirst({
      where: { id: req.params.userId, organizationId: { in: orgIds } },
      select: { id: true, name: true, role: true, organizationId: true, callCenterAccess: true },
    })
    if (!target) return res.status(404).json({ error: "User not found" })
    if (target.role !== "ADMIN") return res.status(400).json({ error: "Only an Admin can be given call-center access" })

    if (target.callCenterAccess !== enabled) {
      await prisma.user.update({ where: { id: target.id }, data: { callCenterAccess: enabled } })
      logAudit({
        organizationId: target.organizationId,
        actorId: userId,
        action: "user.call_center_access_changed",
        targetType: "User",
        targetId: target.id,
        note: `${target.name}: call-center access ${enabled ? "granted" : "removed"}`,
      })
    }
    res.json({ id: target.id, callCenterAccess: enabled })
  } catch (err) {
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

module.exports = { getOrganization, updateOrganization, listCompanyOrganizations, createSubOrganization, archiveSubOrganization, getOrganizationComparison, setMainCompany, setCompanyHierarchy, setOfficeType, listCallCenterAdmins, setCallCenterAccess, grantOrganizationAccess, revokeOrganizationAccess }
