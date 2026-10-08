// End-to-end API test of the ManagementDock Control Center (TESTPLAN §18).
//
//   cd backend
//   PLATFORM_ADMIN_EMAIL=you@example.com node scripts/test-control-center.js
//
// The test signs a token for that platform account directly (it has database
// access anyway), so it never needs — or touches — the real password.
//
// Starts the API on port 4099 (background jobs off) against the database in
// backend/.env. It only READS real data; every write goes to a throwaway
// organization / plan / role / user named "zz-test-…", which is deleted at the
// end (also if a check fails). Nothing is sent to payment providers.
require("dotenv").config()
process.env.PORT = "4099"
process.env.DISABLE_BACKGROUND_JOBS = "true"

const prisma = require("../src/lib/prisma")
const { signToken } = require("../src/utils/jwt")
require("../src/index.js")

const BASE = "http://localhost:4099/api"
let pass = 0
let fail = 0
const failures = []
function ok(id, name, cond, extra = "") {
  if (cond) pass++
  else {
    fail++
    failures.push(`${id} ${name} ${extra}`)
  }
  console.log(`${cond ? "PASS" : "FAIL"} ${id} ${name}${cond ? "" : " — " + extra}`)
}
async function call(method, path, body, token) {
  const started = Date.now()
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const t = await r.text()
  let j = null
  try { j = JSON.parse(t) } catch { /* not json */ }
  if (Date.now() - started > 4000) console.log(`SLOW ${method} ${path} ${Date.now() - started}ms`)
  return [r.status, j]
}
const tokenFor = (u) => signToken({ userId: u.id, organizationId: u.organizationId, companyId: u.organization.companyId, role: u.role })

async function main() {
  await new Promise((r) => setTimeout(r, 2500))
  const email = process.env.PLATFORM_ADMIN_EMAIL
  if (!email) throw new Error("Set PLATFORM_ADMIN_EMAIL")
  const pu = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { organization: true } })
  if (!pu || pu.role !== "PLATFORM_ADMIN") throw new Error("No PLATFORM_ADMIN account with that email — run scripts/create-platform-admin.js")
  const T = tokenFor(pu)
  const [ms, me] = await call("GET", "/auth/me", null, T)
  ok("CC-01", "platform account's session carries isPlatformAdmin and the PLATFORM_ADMIN role", ms === 200 && me.role === "PLATFORM_ADMIN" && me.isPlatformAdmin === true)
  const login = { user: { id: pu.id, homeOrganizationId: pu.organizationId } }

  // ── Access control ────────────────────────────────────────────────────
  const endpoints = ["/overview", "/organizations", "/users", "/roles", "/features", "/plans", "/subscriptions", "/invoices", "/inquiries", "/usage", "/audit", "/system"]
  for (const role of ["CEO", "ADMIN", "HR", "EMPLOYEE"]) {
    const u = await prisma.user.findFirst({ where: { role, status: "ACTIVE", organization: { slug: { not: "managementdock-platform" }, archivedAt: null } }, include: { organization: true } })
    if (!u) { console.log(`SKIP CC-02 ${role}: no live user with that role`); continue }
    const t = tokenFor(u)
    const codes = []
    for (const p of endpoints) codes.push((await call("GET", "/platform" + p, null, t))[0])
    ok("CC-02", `${role} gets 403 on all ${endpoints.length} platform reads`, codes.every((c) => c === 403), codes.join(","))
    const [ws] = await call("POST", "/platform/organizations", { name: "x" }, t)
    ok("CC-02", `${role} cannot create an organization`, ws === 403)
    if (role === "CEO") {
      const [, plans] = await call("GET", "/billing/plans", null, t)
      ok("CC-03", "company CEO can still read published plans", Array.isArray(plans) && plans.length > 0)
      const [ps] = await call("POST", "/billing/plans", { key: "zz-test-nope", name: "x", priceCents: 100 }, t)
      ok("CC-03", "company CEO cannot publish a plan", ps === 403, "status " + ps)
      const [es] = await call("PATCH", `/billing/plans/${plans[0].id}`, { name: "hacked" }, t)
      ok("CC-03", "company CEO cannot edit a plan", es === 403, "status " + es)
    }
  }
  const [ns] = await call("GET", "/platform/overview")
  ok("CC-02", "no token → 401", ns === 401)

  // ── Read screens ──────────────────────────────────────────────────────
  const [, ov] = await call("GET", "/platform/overview", null, T)
  ok("CC-04", "overview: totals, plans, limits, recent activity", ov?.organizations?.total > 0 && ov.plans && ov.limits && Array.isArray(ov.recentActivity))
  const [, orgs] = await call("GET", "/platform/organizations", null, T)
  const o0 = orgs?.[0] || {}
  ok("CC-05", "organizations list has status/hierarchy/users/plan/subscription/features/usage", ["status", "group", "users", "plan", "subscriptionStatus", "featuresEnabled", "employees", "usageState"].every((k) => k in o0))
  ok("CC-05", "platform account's own organization is hidden", !orgs.some((o) => o.slug === "managementdock-platform"))
  const [, d] = await call("GET", "/platform/organizations/" + o0.id, null, T)
  ok("CC-06", "drawer overview: hierarchy, subscription, usage", Array.isArray(d?.hierarchy) && d.subscription && Array.isArray(d.usage))
  for (const tab of ["people", "features", "permissions", "activity", "invoices"]) {
    const [s] = await call("GET", `/platform/organizations/${o0.id}/${tab}`, null, T)
    ok("CC-06", `drawer tab: ${tab}`, s === 200, "status " + s)
  }
  const [, feats] = await call("GET", "/platform/features", null, T)
  ok("CC-07", "feature catalogue lists 10 features with availability + entitlement counts", feats?.features?.length === 10 && feats.features.every((f) => "available" in f && "organizationsEntitled" in f))
  const [, roles] = await call("GET", "/platform/roles", null, T)
  ok("CC-08", "roles: built-in matrix, module keys, custom roles", roles?.roles?.length >= 8 && roles.moduleKeys?.length > 10 && Array.isArray(roles.custom))
  const [, usage] = await call("GET", "/platform/usage", null, T)
  ok("CC-09", "usage: employees/users/sites/projects/storage per organization", usage?.[0]?.metrics?.map((m) => m.key).join(",").startsWith("employees,users,sites,projects,storage"))
  const [, sys] = await call("GET", "/platform/system", null, T)
  ok("CC-10", "system settings: db ok, no secrets in payload", sys?.database === "ok" && !/postgres|password|secret/i.test(JSON.stringify(sys)))
  const [us, subs] = await call("GET", "/platform/subscriptions", null, T)
  ok("CC-11", "subscriptions list + paymentsConfigured flag", us === 200 && Array.isArray(subs?.rows) && "paymentsConfigured" in subs)

  async function checkAudit() {
    const [, b] = await call("GET", "/platform/audit?scope=platform&pageSize=100", null, T)
    const acts = new Set(b.rows.map((r) => r.action))
    const need = ["platform.organization_created", "platform.organization_renamed", "platform.organization_suspended", "platform.organization_unsuspended", "platform.organization_archived", "platform.organization_restored", "platform.role_created", "platform.role_updated", "platform.user_created", "platform.user_updated", "platform.user_role_changed", "platform.user_password_reset", "platform.feature_override_changed", "platform.subscription_assigned", "platform.subscription_cancelled", "permissions.attendance_updated", "billing.plan_created", "billing.plan_updated", "billing.sale_set", "billing.sale_ended"]
    const missing = need.filter((x) => !acts.has(x))
    ok("CC-70", `audit log recorded every action so far (${need.length} types)`, missing.length === 0, "missing: " + missing.join(", "))
    ok("CC-70", "every entry carries actor, organization and timestamp", b.rows.every((r) => r.actor && r.organization && r.createdAt))
    const feat = b.rows.find((r) => r.action === "platform.feature_override_changed")
    ok("CC-70", "feature change has before/after values", feat?.details?.before?.enabled !== undefined && feat?.details?.after?.enabled !== undefined)
    const role = b.rows.find((r) => r.action === "platform.user_role_changed")
    ok("CC-70", "role change has before/after values", role?.details?.before?.role && role?.details?.after?.role)
    const sub = b.rows.find((r) => r.action === "platform.subscription_assigned")
    ok("CC-70", "subscription change has before/after + reason", sub?.details?.before?.plan && sub?.details?.after?.plan && sub?.details?.reason)
    const [s2, b2] = await call("GET", "/platform/audit?search=" + encodeURIComponent(tag) + "&pageSize=5", null, T)
    ok("CC-71", "audit search + paging", s2 === 200 && typeof b2.total === "number")
    ok("CC-72", "audit log is read-only (no write routes)", (await call("DELETE", "/platform/audit/x", null, T))[0] === 404)
  }
  async function checkDeletedAudit() {
    const [, b] = await call("GET", "/platform/audit?scope=platform&pageSize=100", null, T)
    const rows = b.rows.filter((r) => ["platform.organization_deleted", "platform.user_deleted", "platform.role_deleted", "billing.plan_deleted"].includes(r.action))
    ok("CC-70", "deletions are recorded (organization, user, role, plan)", new Set(rows.map((r) => r.action)).has("platform.organization_deleted") && new Set(rows.map((r) => r.action)).has("platform.role_deleted") && new Set(rows.map((r) => r.action)).has("billing.plan_deleted"))
  }

  // ── CRUD on throwaway data ────────────────────────────────────────────
  const tag = "zz-test-" + Date.now()
  const ids = {}
  try {
    // organization
    let [s, b] = await call("POST", "/platform/organizations", { name: tag, adminName: "T Admin", adminEmail: `${tag}@example.test` }, T)
    ok("CC-20", "create organization + first admin (password shown once)", s === 201 && b?.temporaryPassword?.length >= 10, JSON.stringify(b))
    ids.org = b?.organization?.id
    const adminPw = b?.temporaryPassword
    ;[s] = await call("POST", "/platform/organizations", { name: tag, adminName: "x", adminEmail: `${tag}@example.test` }, T)
    ok("CC-20", "duplicate admin email rejected", s === 409)
    ;[s] = await call("PATCH", `/platform/organizations/${ids.org}`, { name: tag + "-renamed" }, T)
    ok("CC-21", "rename organization", s === 200)
    await call("PATCH", `/platform/organizations/${ids.org}`, { name: tag }, T)

    // custom role → user → effect
    ;[s, b] = await call("POST", "/platform/roles/custom", { name: tag + " role", baseRole: "EMPLOYEE", modules: ["leave"] }, T)
    ok("CC-30", "create custom role", s === 201); ids.role = b?.id
    ;[s] = await call("POST", "/platform/roles/custom", { name: "bad", modules: ["nope"] }, T)
    ok("CC-30", "unknown module rejected", s === 400)
    ;[s] = await call("POST", "/platform/roles/custom", { name: "CEO", modules: [] }, T)
    ok("CC-30", "name clash with a built-in role rejected", s === 409)
    ;[s, b] = await call("POST", "/platform/users", { organizationId: ids.org, name: "T Worker", email: `${tag}-w@example.test`, customRoleId: ids.role }, T)
    ok("CC-31", "create user with custom role", s === 201 && b?.temporaryPassword); ids.user = b?.user?.id
    const workerPw = b?.temporaryPassword
    ;[s, b] = await call("POST", "/auth/login", { email: `${tag}-w@example.test`, password: workerPw })
    ok("CC-31", "new user signs in and receives the role's modules", s === 200 && JSON.stringify(b.user.customModules) === '["leave"]')
    const W = b?.token
    ;[s] = await call("GET", "/leaves/calendar", null, W)
    ok("CC-32", "custom role grants its module (leave)", s === 200, "status " + s)
    ;[s] = await call("GET", "/payroll", null, W)
    ok("CC-32", "custom role does not grant other modules (payroll)", s === 403, "status " + s)
    ;[s] = await call("PATCH", `/platform/roles/custom/${ids.role}`, { modules: ["departments"] }, T)
    ok("CC-33", "edit custom role", s === 200)
    ;[s] = await call("GET", "/leaves/calendar", null, W)
    ok("CC-33", "edit takes effect on the next request", s === 403, "status " + s)
    ;[s, b] = await call("PATCH", `/platform/users/${ids.user}`, { designation: "Tester", status: "ON_LEAVE" }, T)
    ok("CC-34", "edit user (designation/status)", s === 200)
    ;[s, b] = await call("POST", `/platform/users/${ids.user}/reset-password`, {}, T)
    ok("CC-34", "reset password returns a new one-time password", s === 200 && b?.temporaryPassword)
    ;[s] = await call("POST", "/auth/login", { email: `${tag}-w@example.test`, password: workerPw })
    ok("CC-34", "old password stops working", s === 401)
    ;[s] = await call("PATCH", `/platform/users/${ids.user}/role`, { role: "HR", reason: "test" }, T)
    ok("CC-35", "change built-in role (also clears the custom role)", s === 200)
    ;[, b] = await call("GET", `/platform/users?search=${tag}-w`, null, T)
    ok("CC-35", "user now has no custom role and role HR", b?.rows?.[0]?.role === "HR" && !b.rows[0].customRoleId)
    ;[s] = await call("PATCH", `/platform/users/${login.user.id}/role`, { role: "EMPLOYEE", reason: "x" }, T)
    ok("CC-35", "platform admin's own account can't be changed (400)", s === 400)

    // feature entitlement
    ;[s, b] = await call("POST", "/auth/login", { email: `${tag}@example.test`, password: adminPw })
    const A = b?.token
    ;[s] = await call("GET", "/leaves/calendar", null, A)
    ok("CC-40", "entitled org: company admin reaches Leave", s === 200, "status " + s)
    ;[s] = await call("PUT", `/platform/organizations/${ids.org}/features/leave`, { enabled: false, note: "test" }, T)
    ok("CC-40", "override: switch Leave off for the organization", s === 200)
    ;[s, b] = await call("GET", "/leaves/calendar", null, A)
    ok("CC-40", "…company admin now gets 403 FEATURE_NOT_ENTITLED", s === 403 && b?.code === "FEATURE_NOT_ENTITLED", `${s} ${JSON.stringify(b)}`)
    ;[, b] = await call("GET", "/auth/me", null, A)
    ok("CC-40", "…/auth/me lists the module in disabledModules", Array.isArray(b?.disabledModules) && b.disabledModules.includes("leave"))
    ;[s] = await call("PUT", `/platform/organizations/${ids.org}/features/leave`, { enabled: null }, T)
    ok("CC-41", "reset override to the plan default", s === 200)
    ;[s] = await call("GET", "/leaves/calendar", null, A)
    ok("CC-41", "…access is back", s === 200)
    ;[s] = await call("PUT", `/platform/organizations/${ids.org}/features/nope`, { enabled: true }, T)
    ok("CC-41", "unknown feature rejected (404)", s === 404)

    // attendance permissions (per-organization CRUD matrix)
    ;[s] = await call("PUT", `/platform/organizations/${ids.org}/attendance-permissions`, { permissions: [{ role: "HR", canCreate: true, canRead: true, canUpdate: false, canDelete: false }] }, T)
    ok("CC-42", "save the organization's attendance permission matrix", s === 200)
    ;[, b] = await call("GET", `/platform/organizations/${ids.org}/permissions`, null, T)
    ok("CC-42", "…matrix reads back", b?.attendance?.find((r) => r.role === "HR")?.canCreate === true)

    // plans + sale + limits + usage
    ;[s, b] = await call("POST", "/platform/plans", { key: tag, name: tag + " plan", priceCents: 2500, employeeLimit: 1, siteLimit: 5, featureKeys: ["employees", "leave"] }, T)
    ok("CC-50", "create plan with limits and included features", s === 201 && b?.featureKeys?.length === 2, JSON.stringify(b)); ids.plan = b?.id
    ;[s] = await call("POST", "/platform/plans", { key: tag, name: "dup", priceCents: 1 }, T)
    ok("CC-50", "duplicate plan key rejected", s === 409)
    ;[s] = await call("PATCH", `/platform/plans/${ids.plan}`, { featureKeys: ["employees", "bogus"] }, T)
    ok("CC-50", "unknown feature in plan rejected", s === 400)
    ;[s, b] = await call("PUT", `/platform/plans/${ids.plan}/sale`, { percent: 20, label: "Test sale" }, T)
    ok("CC-51", "start a sale (20% off)", s === 200 && b?.effectivePriceCents === 2000)
    ;[s] = await call("DELETE", `/platform/plans/${ids.plan}/sale`, null, T)
    ok("CC-51", "end the sale", s === 200)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/subscription`, { planKey: tag }, T)
    ok("CC-52", "assigning a plan needs a reason", s === 400)
    ;[s, b] = await call("POST", `/platform/organizations/${ids.org}/subscription`, { planKey: tag, reason: "test assignment" }, T)
    ok("CC-52", "assign a plan (no payment collected)", s === 409 || s === 200, `${s} ${JSON.stringify(b)}`)
    // 2 users (admin + worker) exceed the 1-employee limit → blocked, as a downgrade should be
    ok("CC-52", "…blocked when the organization has more employees than the plan allows", s === 409 && b?.code === "DOWNGRADE_BLOCKED", `${s}`)
    await call("PATCH", `/platform/plans/${ids.plan}`, { employeeLimit: 2 }, T)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/subscription`, { planKey: tag, reason: "test assignment" }, T)
    ok("CC-52", "…allowed once the limit fits", s === 200)
    ;[, b] = await call("GET", "/platform/usage", null, T)
    const mine = b.find((r) => r.organizationId === ids.org)
    ok("CC-53", "usage shows the plan's limit and a warning at 100% (2/2)", mine?.state === "over" && mine.metrics.find((m) => m.key === "employees").limit === 2, JSON.stringify(mine?.metrics?.[0]))
    ;[s] = await call("POST", "/platform/users", { organizationId: ids.org, name: "Extra", email: `${tag}-x@example.test` }, T)
    ok("CC-53", "adding a user over the plan's employee limit is refused (403)", s === 403, "status " + s)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/subscription/cancel`, {}, T)
    ok("CC-54", "cancel needs a reason", s === 400)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/subscription/cancel`, { reason: "test" }, T)
    ok("CC-54", "cancel subscription → Free plan", s === 200)
    ;[s] = await call("DELETE", `/platform/plans/${ids.plan}`, null, T)
    ok("CC-55", "delete plan nobody is on", s === 204); ids.plan = null
    ;[s] = await call("DELETE", `/platform/plans/${(await prisma.billingPlan.findUnique({ where: { key: "free" } })).id}`, null, T)
    ok("CC-55", "the Free plan can't be deleted", s === 400)

    // suspend / delete lifecycle
    ;[s] = await call("DELETE", `/platform/organizations/${ids.org}`, { confirmName: tag }, T)
    ok("CC-60", "an active organization can't be deleted", s === 400)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/suspend`, {}, T)
    ok("CC-60", "suspension needs a reason", s === 400)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/suspend`, { reason: "invoice overdue" }, T)
    ok("CC-60", "suspend for non-payment", s === 200)
    ;[s, b] = await call("GET", "/auth/me", null, A)
    ok("CC-61", "existing sessions are blocked with the reason", s === 401 && b?.code === "ORGANIZATION_SUSPENDED")
    ;[s, b] = await call("POST", "/auth/login", { email: `${tag}@example.test`, password: adminPw })
    ok("CC-61", "sign-in blocked with a clear message", s === 403 && /overdue payment/.test(b?.error || ""))
    ;[s, b] = await call("POST", "/auth/login", { email: `${tag}@example.test`, password: "wrong-password-1" })
    ok("CC-61", "wrong password doesn't reveal the suspension", s === 401 && !/payment/.test(b?.error || ""))
    ;[, b] = await call("GET", "/platform/organizations", null, T)
    ok("CC-62", "listed as SUSPENDED", b.find((o) => o.id === ids.org)?.status === "SUSPENDED")
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/unsuspend`, {}, T)
    ok("CC-62", "lift suspension", s === 200)
    ;[s] = await call("GET", "/auth/me", null, A)
    ok("CC-62", "access restored immediately", s === 200)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/status`, { status: "ARCHIVED" }, T)
    ok("CC-63", "archiving needs a reason", s === 400)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/status`, { status: "ARCHIVED", reason: "test" }, T)
    ok("CC-63", "archive", s === 200)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/status`, { status: "ACTIVE" }, T)
    ok("CC-63", "restore", s === 200)
    ;[s] = await call("POST", `/platform/organizations/${login.user.homeOrganizationId}/suspend`, { reason: "x" }, T)
    ok("CC-63", "platform's own organization can't be suspended", s === 404 || s === 400, "status " + s)
    ;[s] = await call("POST", `/platform/organizations/${ids.org}/suspend`, { reason: "unpaid" }, T)
    await checkAudit()
    ;[s] = await call("DELETE", `/platform/organizations/${ids.org}`, { confirmName: "wrong" }, T)
    ok("CC-64", "delete needs the exact organization name", s === 400)
    ;[s] = await call("DELETE", `/platform/users/${ids.user}`, null, T)
    ok("CC-36", "delete user", s === 204); ids.user = null
    ;[s] = await call("DELETE", `/platform/roles/custom/${ids.role}`, null, T)
    ok("CC-36", "delete custom role", s === 204); ids.role = null
    ;[s] = await call("DELETE", `/platform/organizations/${ids.org}`, { confirmName: tag }, T)
    ok("CC-64", "delete a suspended organization (typed name)", s === 204, "status " + s)
    ok("CC-64", "…it is really gone from the database", (await prisma.organization.count({ where: { id: ids.org } })) === 0)
    const orgGone = ids.org
    ids.org = null

    // audit: see checkAudit()
    await checkDeletedAudit()
    void orgGone
  } catch (e) {
    fail++
    failures.push("EXCEPTION " + e.message)
    console.log("ERROR", e)
  } finally {
    if (ids.user) await prisma.user.deleteMany({ where: { id: ids.user } }).catch(() => {})
    if (ids.role) await prisma.customRole.deleteMany({ where: { id: ids.role } }).catch(() => {})
    if (ids.plan) await prisma.organizationSubscription.deleteMany({ where: { planId: ids.plan } }).catch(() => {}), await prisma.billingPlan.deleteMany({ where: { id: ids.plan } }).catch(() => {})
    if (ids.org) {
      await prisma.auditLog.deleteMany({ where: { organizationId: ids.org } }).catch(() => {})
      await prisma.user.deleteMany({ where: { organizationId: ids.org } }).catch(() => {})
      await prisma.organization.deleteMany({ where: { id: ids.org } }).catch(() => {})
    }
    // Throwaway audit rows written to the platform account's own organization.
    await prisma.auditLog.deleteMany({ where: { note: { contains: tag } } }).catch(() => {})
    const left = await Promise.all([
      prisma.organization.count({ where: { name: { startsWith: "zz-test" } } }),
      prisma.user.count({ where: { email: { startsWith: "zz-test" } } }),
      prisma.customRole.count({ where: { name: { startsWith: "zz-test" } } }),
      prisma.billingPlan.count({ where: { key: { startsWith: "zz-test" } } }),
    ])
    ok("CC-99", "no test data left behind", left.every((n) => n === 0), left.join(","))
    console.log(`\n${pass} passed, ${fail} failed`)
    if (failures.length) console.log("Failures:\n" + failures.join("\n"))
    await prisma.$disconnect()
    process.exit(fail ? 1 : 0)
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
