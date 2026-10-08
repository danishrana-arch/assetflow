const crypto = require("crypto")
const bcrypt = require("bcrypt")
const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { isValidTimeZone } = require("../utils/timezone")
const { DEFAULT_LATE_RULE } = require("../utils/late-rules")
const { checkEmployeeCapacity } = require("../utils/billing")
const { ASSIGNABLE_ROLES, ROLE_MODULES, ALL_MODULE_KEYS, MAX_CEO_COUNT } = require("../utils/roles")
const { CONFIGURABLE_ATTENDANCE_ROLES, ALWAYS_FULL_ATTENDANCE_ROLES } = require("../utils/permissions")
const { PLATFORM_ORG_SLUG } = require("../utils/platform")

// Create / update / delete operations of the Control Center (platform
// administrator only — see routes/platform.routes.js). Every change is audited
// with before/after values, and every destructive one is refused with a clear
// reason instead of half-working.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USER_STATUSES = ["ACTIVE", "ON_LEAVE", "LEFT_COMPANY"]
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)
const tempPassword = () => crypto.randomBytes(9).toString("base64url")
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "role"

function audit(req, organizationId, action, { targetType, targetId, note, before, after, extra } = {}) {
  return logAudit({
    organizationId: organizationId || req.user.homeOrganizationId,
    actorId: req.user.userId,
    action,
    targetType,
    targetId,
    note,
    details: { before: before ?? null, after: after ?? null, ...(extra || {}), byPlatformAdmin: true },
  })
}

// A database refusal because other records still point at the row.
const blockedByRecords = (err) => err?.code === "P2003" || err?.code === "P2014"

// ── Custom roles ──────────────────────────────────────────────────────────

function parseRoleInput(body, { partial }) {
  const out = {}
  const has = (k) => body[k] !== undefined
  if (!partial || has("name")) {
    const name = text(body.name, 60)
    if (!name) return { error: "Role name is required" }
    out.name = name
  }
  if (has("description")) out.description = text(body.description, 300) || ""
  if (has("baseRole")) {
    if (!ASSIGNABLE_ROLES.includes(body.baseRole)) return { error: "Base role isn't valid" }
    out.baseRole = body.baseRole
  }
  if (!partial || has("modules")) {
    if (!Array.isArray(body.modules)) return { error: "Modules must be a list" }
    const unknown = body.modules.filter((m) => !ALL_MODULE_KEYS.includes(m))
    if (unknown.length) return { error: `Unknown module: ${unknown[0]}` }
    out.modules = [...new Set(body.modules)]
  }
  return { data: out }
}

const roleView = (r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, baseRole: r.baseRole, modules: r.modules, users: r._count?.users ?? 0 })

async function createCustomRole(req, res, next) {
  try {
    const { data, error } = parseRoleInput(req.body, { partial: false })
    if (error) return res.status(400).json({ error })
    const key = slugify(data.name)
    if (ROLE_MODULES[key.toUpperCase().replaceAll("-", "_")]) return res.status(409).json({ error: "That name is used by a built-in role" })
    if (await prisma.customRole.findUnique({ where: { key }, select: { id: true } })) return res.status(409).json({ error: "A role with this name already exists" })
    const role = await prisma.customRole.create({ data: { key, baseRole: "EMPLOYEE", ...data }, include: { _count: { select: { users: true } } } })
    await audit(req, null, "platform.role_created", { targetType: "CustomRole", targetId: role.id, note: role.name, after: { name: role.name, baseRole: role.baseRole, modules: role.modules } })
    res.status(201).json(roleView(role))
  } catch (err) {
    next(err)
  }
}

async function updateCustomRole(req, res, next) {
  try {
    const existing = await prisma.customRole.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: "Role not found" })
    const { data, error } = parseRoleInput(req.body, { partial: true })
    if (error) return res.status(400).json({ error })
    const role = await prisma.$transaction(async (tx) => {
      const updated = await tx.customRole.update({ where: { id: existing.id }, data, include: { _count: { select: { users: true } } } })
      // People on this role follow its base role.
      if (data.baseRole && data.baseRole !== existing.baseRole) await tx.user.updateMany({ where: { customRoleId: existing.id, role: { not: "PLATFORM_ADMIN" } }, data: { role: data.baseRole } })
      return updated
    })
    const pick = (r) => ({ name: r.name, description: r.description, baseRole: r.baseRole, modules: r.modules })
    await audit(req, null, "platform.role_updated", { targetType: "CustomRole", targetId: role.id, note: role.name, before: pick(existing), after: pick(role) })
    res.json(roleView(role))
  } catch (err) {
    next(err)
  }
}

async function deleteCustomRole(req, res, next) {
  try {
    const existing = await prisma.customRole.findUnique({ where: { id: req.params.id }, include: { _count: { select: { users: true } } } })
    if (!existing) return res.status(404).json({ error: "Role not found" })
    await prisma.customRole.delete({ where: { id: existing.id } }) // users fall back to their base role
    await audit(req, null, "platform.role_deleted", { targetType: "CustomRole", targetId: existing.id, note: existing.name, before: { name: existing.name, baseRole: existing.baseRole, modules: existing.modules }, extra: { usersMovedToBaseRole: existing._count.users } })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

// ── Users ─────────────────────────────────────────────────────────────────

async function resolveCustomRole(customRoleId) {
  if (!customRoleId) return null
  return prisma.customRole.findUnique({ where: { id: String(customRoleId) } })
}

async function createUser(req, res, next) {
  try {
    const name = text(req.body.name, 120)
    const email = text(req.body.email, 200)?.toLowerCase()
    if (!name) return res.status(400).json({ error: "Name is required" })
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required" })
    const org = await prisma.organization.findUnique({ where: { id: String(req.body.organizationId || "") }, select: { id: true, name: true, slug: true, archivedAt: true } })
    if (!org || org.slug === PLATFORM_ORG_SLUG) return res.status(404).json({ error: "Organization not found" })
    if (org.archivedAt) return res.status(400).json({ error: "That organization is archived" })
    const custom = await resolveCustomRole(req.body.customRoleId)
    if (req.body.customRoleId && !custom) return res.status(404).json({ error: "Custom role not found" })
    const role = custom ? custom.baseRole : req.body.role || "EMPLOYEE"
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "That role can't be assigned here" })
    if (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } })) return res.status(409).json({ error: "A user with this email already exists" })
    if (role === "CEO" && (await prisma.user.count({ where: { organizationId: org.id, role: "CEO", status: { not: "LEFT_COMPANY" } } })) >= MAX_CEO_COUNT) {
      return res.status(409).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
    }
    const full = await checkEmployeeCapacity(org.id, 1)
    if (full) return res.status(403).json(full)

    const password = tempPassword()
    const user = await prisma.user.create({
      data: { organizationId: org.id, name, email, password: await bcrypt.hash(password, 10), role, customRoleId: custom?.id || null, designation: text(req.body.designation, 120) },
      select: { id: true, name: true, email: true, role: true, status: true },
    })
    await audit(req, org.id, "platform.user_created", { targetType: "User", targetId: user.id, note: `${user.name} (${user.email})`, after: { role, customRole: custom?.name || null, organization: org.name } })
    // Shown once — it isn't stored anywhere in readable form.
    res.status(201).json({ user, temporaryPassword: password })
  } catch (err) {
    next(err)
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { customRole: { select: { name: true } } } })
    if (!user) return res.status(404).json({ error: "User not found" })
    if (user.role === "PLATFORM_ADMIN") return res.status(400).json({ error: "Platform administrators are managed outside the app" })
    const data = {}
    if (req.body.name !== undefined) {
      const name = text(req.body.name, 120)
      if (!name) return res.status(400).json({ error: "Name can't be empty" })
      data.name = name
    }
    if (req.body.email !== undefined) {
      const email = text(req.body.email, 200)?.toLowerCase()
      if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required" })
      if (email !== user.email.toLowerCase() && (await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: user.id } }, select: { id: true } }))) {
        return res.status(409).json({ error: "A user with this email already exists" })
      }
      data.email = email
    }
    if (req.body.designation !== undefined) data.designation = text(req.body.designation, 120)
    if (req.body.status !== undefined) {
      if (!USER_STATUSES.includes(req.body.status)) return res.status(400).json({ error: `Status must be one of: ${USER_STATUSES.join(", ")}` })
      if (user.id === req.user.userId) return res.status(400).json({ error: "You can't change your own status" })
      if (user.status === "LEFT_COMPANY" && req.body.status !== "LEFT_COMPANY") {
        const full = await checkEmployeeCapacity(user.organizationId, 1)
        if (full) return res.status(403).json(full)
      }
      data.status = req.body.status
    }
    let custom
    if (req.body.customRoleId !== undefined) {
      custom = await resolveCustomRole(req.body.customRoleId)
      if (req.body.customRoleId && !custom) return res.status(404).json({ error: "Custom role not found" })
      data.customRoleId = custom ? custom.id : null
      if (custom) data.role = custom.baseRole
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: "Nothing to change" })
    const updated = await prisma.user.update({ where: { id: user.id }, data, include: { customRole: { select: { name: true } } } })
    const pick = (u) => ({ name: u.name, email: u.email, designation: u.designation, status: u.status, role: u.role, customRole: u.customRole?.name || null })
    await audit(req, user.organizationId, "platform.user_updated", { targetType: "User", targetId: user.id, note: updated.name, before: pick(user), after: pick(updated) })
    res.json({ id: updated.id })
  } catch (err) {
    next(err)
  }
}

async function resetUserPassword(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, role: true, organizationId: true } })
    if (!user) return res.status(404).json({ error: "User not found" })
    if (user.role === "PLATFORM_ADMIN") return res.status(400).json({ error: "Platform administrators are managed outside the app" })
    const password = tempPassword()
    await prisma.user.update({ where: { id: user.id }, data: { password: await bcrypt.hash(password, 10), failedLoginAttempts: 0, lastFailedLoginAt: null } })
    await audit(req, user.organizationId, "platform.user_password_reset", { targetType: "User", targetId: user.id, note: user.name })
    res.json({ temporaryPassword: password })
  } catch (err) {
    next(err)
  }
}

// Permanently removes the account. Records that must be kept (payroll history
// etc.) can block it; marking the user "Left company" is the alternative.
async function deleteUser(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, email: true, role: true, organizationId: true } })
    if (!user) return res.status(404).json({ error: "User not found" })
    if (user.id === req.user.userId) return res.status(400).json({ error: "You can't delete your own account" })
    if (user.role === "PLATFORM_ADMIN") return res.status(400).json({ error: "Platform administrators are managed outside the app" })
    try {
      await prisma.$transaction([prisma.employeeFormInvitation.deleteMany({ where: { createdById: user.id } }), prisma.user.delete({ where: { id: user.id } })])
    } catch (err) {
      if (blockedByRecords(err)) return res.status(409).json({ error: "This user still has records that can't be removed. Mark them as “Left company” instead." })
      throw err
    }
    await audit(req, user.organizationId, "platform.user_deleted", { targetType: "User", targetId: user.id, note: `${user.name} (${user.email})`, before: { role: user.role } })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

// ── Organizations ─────────────────────────────────────────────────────────

// Creates a new company (its own group) with its first Admin. Returns that
// Admin's temporary password once.
async function createOrganization(req, res, next) {
  try {
    const name = text(req.body.name, 120)
    const adminName = text(req.body.adminName, 120)
    const adminEmail = text(req.body.adminEmail, 200)?.toLowerCase()
    if (!name) return res.status(400).json({ error: "Organization name is required" })
    if (!adminName) return res.status(400).json({ error: "The first admin's name is required" })
    if (!adminEmail || !EMAIL_RE.test(adminEmail)) return res.status(400).json({ error: "A valid admin email is required" })
    const timezone = req.body.timezone && isValidTimeZone(String(req.body.timezone)) ? String(req.body.timezone) : "Asia/Karachi"
    if (await prisma.user.findFirst({ where: { email: { equals: adminEmail, mode: "insensitive" } }, select: { id: true } })) return res.status(409).json({ error: "A user with this email already exists" })
    const plan = req.body.planKey ? await prisma.billingPlan.findUnique({ where: { key: String(req.body.planKey) } }) : null
    if (req.body.planKey && !plan) return res.status(404).json({ error: "Plan not found" })

    const password = tempPassword()
    const id = crypto.randomUUID()
    const org = await prisma.organization.create({
      data: {
        id,
        name,
        slug: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
        companyId: id,
        timezone,
        latePolicyRules: { create: [DEFAULT_LATE_RULE] },
        users: { create: { name: adminName, email: adminEmail, password: await bcrypt.hash(password, 10), role: "ADMIN" } },
        ...(plan && plan.key !== "free" ? { subscription: { create: { planId: plan.id, status: "ACTIVE", priceCents: 0 } } } : {}),
      },
      select: { id: true, name: true, slug: true },
    })
    await audit(req, org.id, "platform.organization_created", { targetType: "Organization", targetId: org.id, note: org.name, after: { name: org.name, plan: plan?.name || "Free", admin: adminEmail }, extra: plan && plan.key !== "free" ? { manualAssignment: true, paymentCollected: false } : undefined })
    res.status(201).json({ organization: org, adminEmail, temporaryPassword: password })
  } catch (err) {
    next(err)
  }
}

// POST /organizations/:id/suspend { reason } — switch a company off for
// non-payment. Its people are signed out and can't sign back in (they're told
// why); nothing is deleted, and lifting the suspension restores everything.
async function suspendOrganization(req, res, next) {
  try {
    const reason = text(req.body.reason, 300)
    if (!reason) return res.status(400).json({ error: "A reason is required (for example: invoice overdue)" })
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, archivedAt: true, subscription: { select: { status: true, planId: true } } } })
    if (!org || org.slug === PLATFORM_ORG_SLUG) return res.status(404).json({ error: "Organization not found" })
    if (org.id === req.user.homeOrganizationId) return res.status(400).json({ error: "You can't suspend your own organization" })
    if (org.archivedAt) return res.status(400).json({ error: "This organization is archived" })
    if (org.subscription?.status === "SUSPENDED") return res.status(400).json({ error: "Already suspended" })
    const before = org.subscription?.status || "ACTIVE"
    if (org.subscription) {
      await prisma.organizationSubscription.update({ where: { organizationId: org.id }, data: { status: "SUSPENDED" } })
    } else {
      const free = await prisma.billingPlan.findUnique({ where: { key: "free" } })
      if (!free) return res.status(500).json({ error: "The Free plan is missing" })
      await prisma.organizationSubscription.create({ data: { organizationId: org.id, planId: free.id, status: "SUSPENDED", priceCents: 0 } })
    }
    await audit(req, org.id, "platform.organization_suspended", { targetType: "Organization", targetId: org.id, note: org.name, before: { subscriptionStatus: before }, after: { subscriptionStatus: "SUSPENDED" }, extra: { reason } })
    res.json({ id: org.id, status: "SUSPENDED" })
  } catch (err) {
    next(err)
  }
}

// POST /organizations/:id/unsuspend — payment received; access returns at once.
async function unsuspendOrganization(req, res, next) {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, subscription: { select: { status: true } } } })
    if (!org) return res.status(404).json({ error: "Organization not found" })
    if (org.subscription?.status !== "SUSPENDED") return res.status(400).json({ error: "This organization isn't suspended" })
    await prisma.organizationSubscription.update({ where: { organizationId: org.id }, data: { status: "ACTIVE" } })
    await audit(req, org.id, "platform.organization_unsuspended", { targetType: "Organization", targetId: org.id, note: org.name, before: { subscriptionStatus: "SUSPENDED" }, after: { subscriptionStatus: "ACTIVE" }, extra: { reason: text(req.body.reason, 300) } })
    res.json({ id: org.id, status: "ACTIVE" })
  } catch (err) {
    next(err)
  }
}

// Permanent removal of an ARCHIVED or SUSPENDED organization and everything it owns.
// The caller must type the organization's exact name.
async function deleteOrganization(req, res, next) {
  try {
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, slug: true, companyId: true, archivedAt: true, subscription: { select: { status: true } } } })
    if (!org || org.slug === PLATFORM_ORG_SLUG) return res.status(404).json({ error: "Organization not found" })
    if (!org.archivedAt && org.subscription?.status !== "SUSPENDED") return res.status(400).json({ error: "Suspend or archive the organization first — only suspended or archived organizations can be deleted" })
    if (req.body.confirmName !== org.name) return res.status(400).json({ error: "Type the organization's exact name to confirm" })
    if (org.id === req.user.homeOrganizationId) return res.status(400).json({ error: "You can't delete your own organization" })
    const isGroupMain = !org.companyId || org.companyId === org.id
    if (isGroupMain && (await prisma.organization.count({ where: { companyId: org.id, id: { not: org.id } } })) > 0) {
      return res.status(409).json({ error: "Other companies belong to this group. Delete those first." })
    }
    const [users, records] = await Promise.all([prisma.user.count({ where: { organizationId: org.id } }), prisma.auditLog.count({ where: { organizationId: org.id } })])
    try {
      await prisma.$transaction([
        prisma.employeeFormInvitation.deleteMany({ where: { organizationId: org.id } }),
        prisma.auditLog.deleteMany({ where: { organizationId: org.id } }),
        prisma.user.deleteMany({ where: { organizationId: org.id } }),
        prisma.organization.delete({ where: { id: org.id } }),
      ])
    } catch (err) {
      if (blockedByRecords(err)) return res.status(409).json({ error: "This organization still has records that can't be removed automatically. Keep it archived." })
      throw err
    }
    // Written to the platform account's own log — the organization's log went with it.
    await audit(req, null, "platform.organization_deleted", { targetType: "Organization", targetId: org.id, note: org.name, before: { name: org.name, slug: org.slug, users, auditEntries: records } })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

// PUT /organizations/:id/attendance-permissions { permissions: [{ role, canCreate, canRead, canUpdate, canDelete }] }
async function setAttendancePermissions(req, res, next) {
  try {
    const organizationId = req.params.id
    if (!(await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) return res.status(404).json({ error: "Organization not found" })
    const entries = (Array.isArray(req.body.permissions) ? req.body.permissions : []).filter(
      (e) => e?.role && CONFIGURABLE_ATTENDANCE_ROLES.includes(e.role) && !ALWAYS_FULL_ATTENDANCE_ROLES.includes(e.role),
    )
    if (!entries.length) return res.status(400).json({ error: "No changeable roles were sent" })
    const flags = (r) => (r ? { canCreate: r.canCreate, canRead: r.canRead, canUpdate: r.canUpdate, canDelete: r.canDelete } : null)
    const beforeRows = await prisma.attendancePermission.findMany({ where: { organizationId, role: { in: entries.map((e) => e.role) } } })
    await prisma.$transaction(
      entries.map((e) => {
        const f = { canCreate: !!e.canCreate, canRead: !!e.canRead, canUpdate: !!e.canUpdate, canDelete: !!e.canDelete }
        return prisma.attendancePermission.upsert({ where: { organizationId_role: { organizationId, role: e.role } }, update: f, create: { organizationId, role: e.role, ...f } })
      }),
    )
    const before = {}
    const after = {}
    for (const e of entries) {
      before[e.role] = flags(beforeRows.find((r) => r.role === e.role))
      after[e.role] = { canCreate: !!e.canCreate, canRead: !!e.canRead, canUpdate: !!e.canUpdate, canDelete: !!e.canDelete }
    }
    await audit(req, organizationId, "permissions.attendance_updated", { targetType: "AttendancePermission", note: `Roles: ${entries.map((e) => e.role).join(", ")}`, before, after })
    res.json({ saved: entries.length })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  createCustomRole,
  updateCustomRole,
  deleteCustomRole,
  createUser,
  updateUser,
  resetUserPassword,
  deleteUser,
  createOrganization,
  suspendOrganization,
  unsuspendOrganization,
  deleteOrganization,
  setAttendancePermissions,
}
