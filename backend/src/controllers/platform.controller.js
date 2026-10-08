const prisma = require("../lib/prisma")
const pkg = require("../../package.json")
const { logAudit } = require("../utils/audit")
const payments = require("../services/billing-payments")
const { ASSIGNABLE_ROLES, ROLE_MODULES, ALL_MODULE_KEYS, MAX_CEO_COUNT } = require("../utils/roles")
const { FEATURES, FEATURE_BY_KEY, FEATURE_BY_MODULE, resolveFeatures, loadPlatformOff, getOrganizationFeatures, clearEntitlementCache } = require("../utils/features")
const { serializePlan, FREE_PLAN_KEY } = require("../utils/billing")
const { PLATFORM_ORG_SLUG } = require("../utils/platform")

// Control Center API. Mounted at /api/platform behind requireAuth +
// requirePlatformAdmin. These routes work ACROSS every company on the
// platform — which is exactly why they're separate from the company-scoped
// routes and never reachable by a company ADMIN/CEO.

const WARN_AT = 0.8
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null)

// Every platform action is written to the audit log of the organization it
// touched, with structured before/after values.
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

function paging(req, def = 25) {
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || def))
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize }
}

// ── Shared loaders ────────────────────────────────────────────────────────

async function loadOrganizations() {
  // The platform account's own hidden organization is never a customer.
  return prisma.organization.findMany({
    where: { slug: { not: PLATFORM_ORG_SLUG } },
    select: { id: true, name: true, slug: true, companyId: true, createdAt: true, archivedAt: true, timezone: true },
    orderBy: { createdAt: "asc" },
  })
}

const groupIdOf = (org) => org.companyId || org.id

async function loadSubscriptions() {
  const [subs, free] = await Promise.all([
    prisma.organizationSubscription.findMany({ include: { plan: true } }),
    prisma.billingPlan.findUnique({ where: { key: FREE_PLAN_KEY } }),
  ])
  return { byOrg: new Map(subs.map((s) => [s.organizationId, s])), free }
}

function metric(key, label, used, limit, unit) {
  const pct = limit ? used / limit : null
  return { key, label, used, limit: limit ?? null, unit: unit || null, pct, state: limit == null ? "ok" : used > limit ? "over" : used >= limit ? "full" : pct >= WARN_AT ? "warn" : "ok" }
}

// Employees / users / sites / projects / storage per organization, with the
// plan's limit next to each. Only the employee limit is enforced elsewhere;
// the rest are advisory warnings.
async function loadUsage(orgs, subs) {
  const [userGroups, siteGroups, projectGroups, docGroups] = await Promise.all([
    prisma.user.groupBy({ by: ["organizationId", "status"], _count: { _all: true } }),
    prisma.attendanceSite.groupBy({ by: ["organizationId"], _count: { _all: true } }),
    prisma.project.groupBy({ by: ["organizationId"], _count: { _all: true } }),
    prisma.employeeDocument.groupBy({ by: ["organizationId"], _sum: { size: true } }),
  ])
  const employees = new Map()
  const accounts = new Map()
  for (const g of userGroups) {
    accounts.set(g.organizationId, (accounts.get(g.organizationId) || 0) + g._count._all)
    if (g.status !== "LEFT_COMPANY") employees.set(g.organizationId, (employees.get(g.organizationId) || 0) + g._count._all)
  }
  const sites = new Map(siteGroups.map((g) => [g.organizationId, g._count._all]))
  const projects = new Map(projectGroups.map((g) => [g.organizationId, g._count._all]))
  const storage = new Map(docGroups.map((g) => [g.organizationId, g._sum.size || 0]))
  const activeInGroup = new Map()
  for (const o of orgs) if (!o.archivedAt) activeInGroup.set(groupIdOf(o), (activeInGroup.get(groupIdOf(o)) || 0) + 1)

  const out = new Map()
  for (const org of orgs) {
    const plan = subs.byOrg.get(org.id)?.plan || subs.free
    const metrics = [
      metric("employees", "Employees", employees.get(org.id) || 0, plan?.employeeLimit),
      metric("users", "User accounts", accounts.get(org.id) || 0, null),
      metric("sites", "Attendance sites", sites.get(org.id) || 0, plan?.siteLimit),
      metric("projects", "Projects", projects.get(org.id) || 0, plan?.projectLimit),
      metric("storage", "Document storage", Math.round(((storage.get(org.id) || 0) / (1024 * 1024)) * 10) / 10, plan?.storageLimitMb, "MB"),
    ]
    // The organization cap belongs to the company group, so it's shown once, on the group's main company.
    if (groupIdOf(org) === org.id) metrics.push(metric("organizations", "Organizations in group", activeInGroup.get(org.id) || 0, plan?.organizationLimit))
    out.set(org.id, metrics)
  }
  return out
}

const worst = (metrics) => (metrics.some((m) => m.state === "over" || m.state === "full") ? "over" : metrics.some((m) => m.state === "warn") ? "warn" : "ok")

function orgStatus(org, subscriptionStatus) {
  return org.archivedAt ? "ARCHIVED" : subscriptionStatus === "SUSPENDED" ? "SUSPENDED" : "ACTIVE"
}

// ── Overview ──────────────────────────────────────────────────────────────

async function overview(req, res, next) {
  try {
    const orgs = await loadOrganizations()
    const subs = await loadSubscriptions()
    const usage = await loadUsage(orgs, subs)
    const active = orgs.filter((o) => !o.archivedAt)
    const [users, newInquiries, recent] = await Promise.all([
      prisma.user.count({ where: { status: { not: "LEFT_COMPANY" } } }),
      prisma.salesInquiry.count({ where: { status: "NEW" } }),
      prisma.auditLog.findMany({
        where: { details: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { actor: { select: { name: true } }, organization: { select: { name: true } } },
      }),
    ])
    const byPlan = {}
    let paid = 0
    for (const o of active) {
      const sub = subs.byOrg.get(o.id)
      const name = (sub?.plan || subs.free)?.name || "Free"
      byPlan[name] = (byPlan[name] || 0) + 1
      if (sub && sub.priceCents > 0) paid++
    }
    const states = active.map((o) => worst(usage.get(o.id)))
    res.json({
      organizations: { total: orgs.length, active: active.length, archived: orgs.length - active.length, groups: new Set(orgs.map(groupIdOf)).size },
      users,
      plans: byPlan,
      paidOrganizations: paid,
      limits: { warning: states.filter((s) => s === "warn").length, atOrOverLimit: states.filter((s) => s === "over").length },
      newInquiries,
      paymentsConfigured: payments.isConfigured(),
      recentActivity: recent,
    })
  } catch (err) {
    next(err)
  }
}

// ── Organizations ─────────────────────────────────────────────────────────

async function listOrganizations(req, res, next) {
  try {
    const orgs = await loadOrganizations()
    const subs = await loadSubscriptions()
    const [usage, overrides, platformOff] = await Promise.all([
      loadUsage(orgs, subs),
      prisma.organizationFeatureOverride.findMany(),
      loadPlatformOff(),
    ])
    const byId = new Map(orgs.map((o) => [o.id, o]))
    const rows = orgs.map((o) => {
      const sub = subs.byOrg.get(o.id)
      const plan = sub?.plan || subs.free
      const features = resolveFeatures({ plan, overrides: overrides.filter((x) => x.organizationId === o.id), platformOff })
      const metrics = usage.get(o.id)
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        status: orgStatus(o, sub?.status),
        createdAt: o.createdAt,
        isGroupMain: groupIdOf(o) === o.id,
        group: { id: groupIdOf(o), name: byId.get(groupIdOf(o))?.name || o.name },
        plan: plan ? { key: plan.key, name: plan.name } : null,
        subscriptionStatus: sub?.status || "ACTIVE",
        employees: metrics.find((m) => m.key === "employees"),
        users: metrics.find((m) => m.key === "users").used,
        featuresEnabled: features.filter((f) => f.enabled).length,
        featuresTotal: features.length,
        usageState: worst(metrics),
      }
    })
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

async function getOrganization(req, res, next) {
  try {
    const orgs = await loadOrganizations()
    const org = orgs.find((o) => o.id === req.params.id)
    if (!org) return res.status(404).json({ error: "Organization not found" })
    const subs = await loadSubscriptions()
    const usage = await loadUsage(orgs, subs)
    const sub = subs.byOrg.get(org.id)
    const plan = sub?.plan || subs.free
    const groupId = groupIdOf(org)
    const counts = await prisma.user.groupBy({
      by: ["organizationId"],
      where: { organizationId: { in: orgs.filter((o) => groupIdOf(o) === groupId).map((o) => o.id) }, status: { not: "LEFT_COMPANY" } },
      _count: { _all: true },
    })
    const countOf = new Map(counts.map((c) => [c.organizationId, c._count._all]))
    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: orgStatus(org, sub?.status),
      createdAt: org.createdAt,
      archivedAt: org.archivedAt,
      timezone: org.timezone,
      groupId,
      // Companies are peers inside a group (see utils/organization.js); the
      // group's main company is the one the group was created with.
      hierarchy: orgs
        .filter((o) => groupIdOf(o) === groupId)
        .map((o) => ({ id: o.id, name: o.name, status: orgStatus(o, subs.byOrg.get(o.id)?.status), isGroupMain: groupIdOf(o) === o.id, employees: countOf.get(o.id) || 0, current: o.id === org.id })),
      subscription: {
        plan: plan ? serializePlan(plan) : null,
        status: sub?.status || "ACTIVE",
        priceCents: sub?.priceCents || 0,
        currentPeriodEnd: sub?.currentPeriodEnd || null,
        providerLinked: !!sub?.stripeSubscriptionId,
        hasSubscriptionRow: !!sub,
      },
      usage: usage.get(org.id),
    })
  } catch (err) {
    next(err)
  }
}

async function listOrganizationPeople(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.params.id },
      select: { id: true, name: true, email: true, role: true, status: true, designation: true, createdAt: true, department: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      take: 500,
    })
    res.json(users)
  } catch (err) {
    next(err)
  }
}

async function getOrganizationFeatureList(req, res, next) {
  try {
    res.json(await getOrganizationFeatures(req.params.id))
  } catch (err) {
    next(err)
  }
}

async function getOrganizationPermissions(req, res, next) {
  try {
    const [attendance, roleCounts] = await Promise.all([
      prisma.attendancePermission.findMany({ where: { organizationId: req.params.id }, orderBy: { role: "asc" } }),
      prisma.user.groupBy({ by: ["role"], where: { organizationId: req.params.id, status: { not: "LEFT_COMPANY" } }, _count: { _all: true } }),
    ])
    res.json({ attendance, roleCounts: Object.fromEntries(roleCounts.map((r) => [r.role, r._count._all])) })
  } catch (err) {
    next(err)
  }
}

async function getOrganizationActivity(req, res, next) {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { organizationId: req.params.id },
      orderBy: { createdAt: "desc" },
      take: 60,
      include: { actor: { select: { id: true, name: true } } },
    })
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

async function getOrganizationInvoices(req, res, next) {
  try {
    res.json(await prisma.billingInvoice.findMany({ where: { organizationId: req.params.id }, orderBy: { issuedAt: "desc" }, take: 50 }))
  } catch (err) {
    next(err)
  }
}

async function renameOrganization(req, res, next) {
  try {
    const name = text(req.body.name, 120)
    if (!name) return res.status(400).json({ error: "Name is required" })
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } })
    if (!org) return res.status(404).json({ error: "Organization not found" })
    if (org.name === name) return res.json({ id: org.id, name })
    await prisma.organization.update({ where: { id: org.id }, data: { name } })
    await audit(req, org.id, "platform.organization_renamed", { targetType: "Organization", targetId: org.id, note: `${org.name} → ${name}`, before: { name: org.name }, after: { name } })
    res.json({ id: org.id, name })
  } catch (err) {
    next(err)
  }
}

// POST /organizations/:id/status { status: "ARCHIVED" | "ACTIVE", reason }
// Archiving (never a hard delete — an organization owns payroll, attendance
// and audit history that must not vanish) hides it and signs its users out.
async function setOrganizationStatus(req, res, next) {
  try {
    const status = req.body.status
    if (!["ARCHIVED", "ACTIVE"].includes(status)) return res.status(400).json({ error: "Status must be ARCHIVED or ACTIVE" })
    const reason = text(req.body.reason, 300)
    const org = await prisma.organization.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, companyId: true, archivedAt: true } })
    if (!org) return res.status(404).json({ error: "Organization not found" })
    if (orgStatus(org) === status || (status === "ACTIVE" && !org.archivedAt)) return res.status(400).json({ error: `Organization is already ${status.toLowerCase()}` })
    if (status === "ARCHIVED") {
      if (!reason) return res.status(400).json({ error: "A reason is required to archive an organization" })
      if (org.id === req.user.homeOrganizationId) return res.status(400).json({ error: "You can't archive the organization your own account belongs to" })
      const isGroupMain = !org.companyId || org.companyId === org.id
      const others = isGroupMain ? await prisma.organization.count({ where: { id: { not: org.id }, archivedAt: null, companyId: org.id } }) : 0
      if (isGroupMain && others > 0) {
        return res.status(409).json({ error: `${others} other ${others === 1 ? "company belongs" : "companies belong"} to this group. Archive those first.` })
      }
    }
    await prisma.organization.update({ where: { id: org.id }, data: { archivedAt: status === "ARCHIVED" ? new Date() : null } })
    await audit(req, org.id, status === "ARCHIVED" ? "platform.organization_archived" : "platform.organization_restored", {
      targetType: "Organization",
      targetId: org.id,
      note: org.name,
      before: { status: orgStatus(org) },
      after: { status },
      extra: { reason },
    })
    res.json({ id: org.id, status })
  } catch (err) {
    next(err)
  }
}

// ── Features / entitlements ───────────────────────────────────────────────

async function listFeatures(req, res, next) {
  try {
    const orgs = (await loadOrganizations()).filter((o) => !o.archivedAt)
    const subs = await loadSubscriptions()
    const [overrides, platformOff, plans] = await Promise.all([
      prisma.organizationFeatureOverride.findMany(),
      loadPlatformOff(),
      prisma.billingPlan.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, name: true, featureKeys: true } }),
    ])
    const entitled = Object.fromEntries(FEATURES.map((f) => [f.key, 0]))
    for (const o of orgs) {
      const plan = subs.byOrg.get(o.id)?.plan || subs.free
      for (const f of resolveFeatures({ plan, overrides: overrides.filter((x) => x.organizationId === o.id), platformOff })) if (f.enabled) entitled[f.key]++
    }
    res.json({
      organizations: orgs.length,
      features: FEATURES.map((f) => ({
        ...f,
        available: !platformOff.has(f.key),
        organizationsEntitled: entitled[f.key],
        overrides: overrides.filter((o) => o.featureKey === f.key).length,
        plans: plans.filter((p) => p.featureKeys.includes(f.key)).map((p) => p.name),
      })),
    })
  } catch (err) {
    next(err)
  }
}

// PATCH /features/:key { enabled } — platform-wide availability.
async function setFeatureAvailability(req, res, next) {
  try {
    const key = req.params.key
    if (!FEATURE_BY_KEY[key]) return res.status(404).json({ error: "Unknown feature" })
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" })
    const existing = await prisma.platformFeature.findUnique({ where: { key } })
    const before = existing ? existing.enabled : true
    await prisma.platformFeature.upsert({
      where: { key },
      update: { enabled: req.body.enabled, updatedById: req.user.userId },
      create: { key, enabled: req.body.enabled, updatedById: req.user.userId },
    })
    clearEntitlementCache()
    await audit(req, null, "platform.feature_availability_changed", {
      targetType: "Feature",
      targetId: key,
      note: `${FEATURE_BY_KEY[key].label}: ${req.body.enabled ? "available" : "switched off for everyone"}`,
      before: { enabled: before },
      after: { enabled: req.body.enabled },
    })
    res.json({ key, available: req.body.enabled })
  } catch (err) {
    next(err)
  }
}

// PUT /organizations/:id/features/:key { enabled: true | false | null, note }
// null removes the override so the plan decides again.
async function setOrganizationFeature(req, res, next) {
  try {
    const { id, key } = req.params
    if (!FEATURE_BY_KEY[key]) return res.status(404).json({ error: "Unknown feature" })
    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!org) return res.status(404).json({ error: "Organization not found" })
    const { enabled } = req.body
    if (enabled !== null && typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true, false or null" })
    const note = text(req.body.note, 300)

    const beforeList = await getOrganizationFeatures(id)
    const before = beforeList.find((f) => f.key === key)
    if (enabled === null) await prisma.organizationFeatureOverride.deleteMany({ where: { organizationId: id, featureKey: key } })
    else {
      await prisma.organizationFeatureOverride.upsert({
        where: { organizationId_featureKey: { organizationId: id, featureKey: key } },
        update: { enabled, note, updatedById: req.user.userId },
        create: { organizationId: id, featureKey: key, enabled, note, updatedById: req.user.userId },
      })
    }
    clearEntitlementCache()
    const after = (await getOrganizationFeatures(id)).find((f) => f.key === key)
    await audit(req, id, "platform.feature_override_changed", {
      targetType: "Feature",
      targetId: key,
      note: `${FEATURE_BY_KEY[key].label}: ${enabled === null ? "back to the plan default" : enabled ? "enabled by override" : "disabled by override"}`,
      before: { enabled: before.enabled, source: before.source },
      after: { enabled: after.enabled, source: after.source },
      extra: { note },
    })
    res.json(after)
  } catch (err) {
    next(err)
  }
}

// ── Roles & permissions ───────────────────────────────────────────────────

async function listRoles(req, res, next) {
  try {
    const [counts, custom] = await Promise.all([
      prisma.user.groupBy({ by: ["role"], where: { status: { not: "LEFT_COMPANY" } }, _count: { _all: true } }),
      prisma.customRole.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    ])
    const countOf = Object.fromEntries(counts.map((c) => [c.role, c._count._all]))
    // Role → module access is defined in code (utils/roles.js); show it as is.
    res.json({
      roles: Object.keys(ROLE_MODULES).map((role) => ({ role, modules: ROLE_MODULES[role], users: countOf[role] || 0, assignable: ASSIGNABLE_ROLES.includes(role) })),
      modules: [...new Set(Object.values(ROLE_MODULES).flat().filter((m) => m !== "*"))].sort().map((m) => ({ key: m, feature: FEATURE_BY_MODULE[m] || null })),
      features: FEATURES.map((f) => ({ key: f.key, label: f.label })),
      moduleKeys: ALL_MODULE_KEYS,
      assignableRoles: ASSIGNABLE_ROLES,
      custom: custom.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, baseRole: r.baseRole, modules: r.modules, users: r._count.users })),
    })
  } catch (err) {
    next(err)
  }
}

// ── Users ─────────────────────────────────────────────────────────────────

async function listUsers(req, res, next) {
  try {
    const { page, pageSize, skip, take } = paging(req)
    const q = text(req.query.search, 80)
    const where = {
      organization: { slug: { not: PLATFORM_ORG_SLUG } },
      ...(req.query.organizationId ? { organizationId: String(req.query.organizationId) } : {}),
      ...(req.query.role ? { role: String(req.query.role) } : {}),
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    }
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, email: true, role: true, status: true, designation: true, createdAt: true, customRoleId: true, customRole: { select: { name: true } }, organization: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ rows, total, page, pageSize })
  } catch (err) {
    next(err)
  }
}

// PATCH /users/:id/role { role, reason }
async function changeUserRole(req, res, next) {
  try {
    const { role } = req.body
    const reason = text(req.body.reason, 300)
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: "That role can't be assigned here" })
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, role: true, organizationId: true, status: true } })
    if (!user) return res.status(404).json({ error: "User not found" })
    if (user.id === req.user.userId) return res.status(400).json({ error: "You can't change your own role" })
    if (user.role === "PLATFORM_ADMIN") return res.status(400).json({ error: "Platform administrators are managed outside the app" })
    if (user.role === role) return res.status(400).json({ error: "They already have that role" })
    if (role === "CEO") {
      const ceos = await prisma.user.count({ where: { organizationId: user.organizationId, role: "CEO", status: { not: "LEFT_COMPANY" } } })
      if (ceos >= MAX_CEO_COUNT) return res.status(409).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
    }
    // Picking a built-in role replaces any custom role.
    await prisma.user.update({ where: { id: user.id }, data: { role, customRoleId: null } })
    await audit(req, user.organizationId, "platform.user_role_changed", {
      targetType: "User",
      targetId: user.id,
      note: `${user.name}: ${user.role} → ${role}`,
      before: { role: user.role },
      after: { role },
      extra: { reason },
    })
    res.json({ id: user.id, role })
  } catch (err) {
    next(err)
  }
}

// ── Subscriptions / billing ───────────────────────────────────────────────

async function listSubscriptions(req, res, next) {
  try {
    const orgs = (await loadOrganizations()).filter((o) => !o.archivedAt)
    const subs = await loadSubscriptions()
    res.json({
      paymentsConfigured: payments.isConfigured(),
      rows: orgs.map((o) => {
        const sub = subs.byOrg.get(o.id)
        const plan = sub?.plan || subs.free
        return {
          organizationId: o.id,
          organization: o.name,
          plan: plan ? { key: plan.key, name: plan.name } : null,
          status: sub?.status || "ACTIVE",
          priceCents: sub?.priceCents || 0,
          currency: plan?.currency || "usd",
          currentPeriodEnd: sub?.currentPeriodEnd || null,
          providerLinked: !!sub?.stripeSubscriptionId,
        }
      }),
    })
  } catch (err) {
    next(err)
  }
}

async function usageFor(organizationId) {
  const used = await prisma.user.count({ where: { organizationId, status: { not: "LEFT_COMPANY" } } })
  return used
}

// POST /organizations/:id/subscription { planKey, status?, reason }
// An administrative assignment: it moves the organization onto the plan and
// records who did it, but collects NO payment — paid plans are only charged
// through the payment provider (not connected yet), so a manual assignment
// is stored with a $0 price and says so in the audit trail.
async function assignSubscription(req, res, next) {
  try {
    const organizationId = req.params.id
    const reason = text(req.body.reason, 300)
    if (!reason) return res.status(400).json({ error: "A reason is required" })
    const status = req.body.status || "ACTIVE"
    if (!["ACTIVE", "PAST_DUE", "CANCELED", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "Status must be ACTIVE, PAST_DUE, CANCELED or SUSPENDED" })
    const [org, plan, existing] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
      prisma.billingPlan.findUnique({ where: { key: String(req.body.planKey || "") } }),
      prisma.organizationSubscription.findUnique({ where: { organizationId }, include: { plan: true } }),
    ])
    if (!org) return res.status(404).json({ error: "Organization not found" })
    if (!plan) return res.status(404).json({ error: "Plan not found" })
    if (!plan.active && plan.key !== FREE_PLAN_KEY) return res.status(400).json({ error: "That plan is inactive" })
    const used = await usageFor(organizationId)
    if (plan.employeeLimit != null && used > plan.employeeLimit) {
      return res.status(409).json({ error: `${org.name} has ${used} employees but the ${plan.name} plan allows ${plan.employeeLimit}.`, code: "DOWNGRADE_BLOCKED" })
    }
    const free = await prisma.billingPlan.findUnique({ where: { key: FREE_PLAN_KEY } })
    const before = { plan: (existing?.plan || free)?.name || "Free", status: existing?.status || "ACTIVE", priceCents: existing?.priceCents || 0 }
    if (existing?.stripeSubscriptionId && plan.id !== existing.planId) await payments.cancelSubscription({ organizationId, subscription: existing })
    const data = { planId: plan.id, status, priceCents: 0, currentPeriodStart: null, currentPeriodEnd: null, stripeSubscriptionId: null }
    await prisma.organizationSubscription.upsert({ where: { organizationId }, update: data, create: { organizationId, ...data } })
    clearEntitlementCache()
    await audit(req, organizationId, "platform.subscription_assigned", {
      targetType: "Organization",
      targetId: organizationId,
      note: `${before.plan} → ${plan.name} (${status})`,
      before,
      after: { plan: plan.name, status, priceCents: 0 },
      extra: { reason, manualAssignment: true, paymentCollected: false },
    })
    res.json({ organizationId, plan: serializePlan(plan), status })
  } catch (err) {
    next(err)
  }
}

// POST /organizations/:id/subscription/cancel { reason } — back to Free.
async function cancelSubscription(req, res, next) {
  try {
    const organizationId = req.params.id
    const reason = text(req.body.reason, 300)
    if (!reason) return res.status(400).json({ error: "A reason is required" })
    const [existing, free] = await Promise.all([
      prisma.organizationSubscription.findUnique({ where: { organizationId }, include: { plan: true } }),
      prisma.billingPlan.findUnique({ where: { key: FREE_PLAN_KEY } }),
    ])
    if (!existing || existing.plan.key === FREE_PLAN_KEY) return res.status(400).json({ error: "This organization is already on the Free plan" })
    if (!free) return res.status(500).json({ error: "The Free plan is missing" })
    const used = await usageFor(organizationId)
    if (free.employeeLimit != null && used > free.employeeLimit) {
      return res.status(409).json({ error: `The Free plan allows ${free.employeeLimit} employees but this organization has ${used}.`, code: "DOWNGRADE_BLOCKED" })
    }
    await payments.cancelSubscription({ organizationId, subscription: existing })
    await prisma.organizationSubscription.update({
      where: { organizationId },
      data: { planId: free.id, status: "ACTIVE", priceCents: 0, currentPeriodStart: null, currentPeriodEnd: null, stripeSubscriptionId: null },
    })
    clearEntitlementCache()
    await audit(req, organizationId, "platform.subscription_cancelled", {
      targetType: "Organization",
      targetId: organizationId,
      note: `${existing.plan.name} → Free`,
      before: { plan: existing.plan.name, status: existing.status, priceCents: existing.priceCents },
      after: { plan: free.name, status: "ACTIVE", priceCents: 0 },
      extra: { reason },
    })
    res.json({ organizationId, plan: serializePlan(free) })
  } catch (err) {
    next(err)
  }
}

async function listInvoices(req, res, next) {
  try {
    const { page, pageSize, skip, take } = paging(req)
    const where = req.query.organizationId ? { organizationId: String(req.query.organizationId) } : {}
    const [total, rows] = await Promise.all([
      prisma.billingInvoice.count({ where }),
      prisma.billingInvoice.findMany({ where, skip, take, orderBy: { issuedAt: "desc" }, include: { organization: { select: { name: true } } } }),
    ])
    res.json({ rows, total, page, pageSize, paymentsConfigured: payments.isConfigured() })
  } catch (err) {
    next(err)
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────

async function listUsage(req, res, next) {
  try {
    const orgs = (await loadOrganizations()).filter((o) => !o.archivedAt)
    const subs = await loadSubscriptions()
    const usage = await loadUsage(orgs, subs)
    res.json(
      orgs.map((o) => ({
        organizationId: o.id,
        organization: o.name,
        plan: (subs.byOrg.get(o.id)?.plan || subs.free)?.name || "Free",
        state: worst(usage.get(o.id)),
        metrics: usage.get(o.id),
      })),
    )
  } catch (err) {
    next(err)
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────

async function listAudit(req, res, next) {
  try {
    const { page, pageSize, skip, take } = paging(req, 30)
    const q = text(req.query.search, 80)
    const from = req.query.from ? new Date(req.query.from) : null
    const to = req.query.to ? new Date(req.query.to) : null
    const where = {
      ...(req.query.organizationId ? { organizationId: String(req.query.organizationId) } : {}),
      ...(req.query.actorId ? { actorId: String(req.query.actorId) } : {}),
      // "platform" = actions taken from the Control Center or on platform configuration.
      ...(req.query.scope === "platform" ? { OR: [{ action: { startsWith: "platform." } }, { action: { startsWith: "billing." } }, { action: { startsWith: "permissions." } }] } : {}),
      ...(req.query.action ? { action: { contains: String(req.query.action), mode: "insensitive" } } : {}),
      ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" } }, { note: { contains: q, mode: "insensitive" } }, { actor: { name: { contains: q, mode: "insensitive" } } }] } : {}),
      ...((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))
        ? { createdAt: { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) } }
        : {}),
    }
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { id: true, name: true } }, organization: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ rows, total, page, pageSize })
  } catch (err) {
    next(err)
  }
}

// ── System settings (read-only status — never any secret values) ─────────

async function systemSettings(req, res, next) {
  try {
    let database = "ok"
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      database = "error"
    }
    const has = (name) => !!process.env[name]
    res.json({
      version: pkg.version,
      environment: process.env.NODE_ENV || "development",
      database,
      appUrl: process.env.APP_URL || null,
      payments: { configured: payments.isConfigured(), provider: "Stripe", note: "Provider calls live in backend/src/services/billing-payments.js; keys stay server-side." },
      email: { configured: has("SMTP_HOST") && has("SMTP_USER"), from: process.env.SMTP_FROM || null, salesInbox: has("SALES_EMAIL") },
      backgroundJobs: { enabled: process.env.DISABLE_BACKGROUND_JOBS !== "true" },
      platformAdmins: { byRole: "PLATFORM_ADMIN only — created with scripts/create-platform-admin.js" },
      cache: { entitlementTtlSeconds: 30 },
    })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  overview,
  listOrganizations,
  getOrganization,
  listOrganizationPeople,
  getOrganizationFeatureList,
  getOrganizationPermissions,
  getOrganizationActivity,
  getOrganizationInvoices,
  renameOrganization,
  setOrganizationStatus,
  listFeatures,
  setFeatureAvailability,
  setOrganizationFeature,
  listRoles,
  listUsers,
  changeUserRole,
  listSubscriptions,
  assignSubscription,
  cancelSubscription,
  listInvoices,
  listUsage,
  listAudit,
  systemSettings,
}
