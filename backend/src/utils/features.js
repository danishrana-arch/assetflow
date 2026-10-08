const prisma = require("../lib/prisma")

// Feature entitlement — the commercial layer that sits ON TOP of the role →
// module map in utils/roles.js. Four separate questions, answered separately:
//
//   1. Availability   — is the feature switched on for the whole platform?
//                       (PlatformFeature; no row = on)
//   2. Entitlement    — does THIS organization get it? The plan's `featureKeys`,
//                       unless a platform admin set an override for the org
//                       (OrganizationFeatureOverride).
//   3. Role permission — may this ROLE use the module? (ROLE_MODULES)
//   4. User access    — the per-user flags that already exist
//                       (e.g. canManageAttendance).
//
// Access = 1 AND 2 AND 3 (and 4 where it applies). requireModule() in
// auth.middleware.js does the 2 part; role checks are unchanged.
//
// A feature is NOT a new module: `modules` lists the existing ROLE_MODULES
// keys it covers, so there is exactly one set of module keys in the app.
// Features without a ROLE_MODULES key (`biometric`, `orgComparison`) are
// enforced on their routes with requireFeature().
//
// Keep the keys equal to the list in the 20261008140000_control_center
// migration (the plans' initial featureKeys).
const FEATURES = [
  { key: "employees", label: "Employees", group: "People", modules: ["employees", "employeeForms", "certifications", "departments"], description: "Directory, profiles, forms, certifications, departments." },
  { key: "attendance", label: "Attendance", group: "People", modules: ["attendance", "siteAttendance"], description: "Daily attendance, attendance sites, site admins, corrections." },
  { key: "leave", label: "Leave", group: "People", modules: ["leave"], description: "Leave requests, balances and policy." },
  { key: "performance", label: "Performance", group: "People", modules: ["performance"], description: "Performance reviews and bonuses (Employee 360)." },
  { key: "payroll", label: "Payroll", group: "Finance", modules: ["payroll", "payrollReports", "expenseClaims"], description: "Payslips, payroll reports, expense claims." },
  { key: "projects", label: "Projects & tasks", group: "Work", modules: ["projects", "tasks"], description: "Projects and their tasks." },
  { key: "assets", label: "Assets & IT", group: "Assets", modules: ["inventory", "assets", "assetAssignments", "assetRequests", "tickets"], description: "Inventory, assignments, requests and support tickets." },
  { key: "reports", label: "Reports", group: "Reports", modules: ["reports", "hrReports"], description: "HR reports and exports." },
  { key: "biometric", label: "Biometric devices", group: "Attendance", modules: [], description: "Attendance devices (ZKTeco/ADMS) and punches." },
  { key: "orgComparison", label: "Organization comparison", group: "Reports", modules: [], description: "Side-by-side company comparison." },
]

const FEATURE_KEYS = FEATURES.map((f) => f.key)
const FEATURE_BY_KEY = Object.fromEntries(FEATURES.map((f) => [f.key, f]))
const FEATURE_BY_MODULE = {}
for (const f of FEATURES) for (const m of f.modules) FEATURE_BY_MODULE[m] = f.key

const CACHE_TTL_MS = 30 * 1000
const cache = new Map() // organizationId -> { at, value }
let warned = false

function clearEntitlementCache() {
  cache.clear()
}

// How each feature resolves for an organization, with where the answer came from.
//   source: PLATFORM_OFF | OVERRIDE | PLAN | NO_PLAN
function resolveFeatures({ plan, overrides, platformOff }) {
  return FEATURES.map((f) => {
    const override = overrides.find((o) => o.featureKey === f.key)
    let enabled
    let source
    if (platformOff.has(f.key)) {
      enabled = false
      source = "PLATFORM_OFF"
    } else if (override) {
      enabled = override.enabled
      source = "OVERRIDE"
    } else if (!plan) {
      // The plan row is gone — never lock a company out because of that.
      enabled = true
      source = "NO_PLAN"
    } else {
      enabled = plan.featureKeys.includes(f.key)
      source = "PLAN"
    }
    return { ...f, enabled, source, override: override ? { enabled: override.enabled, note: override.note, updatedAt: override.updatedAt } : null }
  })
}

async function loadPlatformOff(db = prisma) {
  const rows = await db.platformFeature.findMany({ where: { enabled: false }, select: { key: true } })
  return new Set(rows.map((r) => r.key))
}

async function planFor(organizationId, db = prisma) {
  const sub = await db.organizationSubscription.findUnique({ where: { organizationId }, include: { plan: true } })
  if (sub) return sub.plan
  return db.billingPlan.findUnique({ where: { key: "free" } })
}

async function getOrganizationFeatures(organizationId, db = prisma) {
  const [plan, overrides, platformOff] = await Promise.all([
    planFor(organizationId, db),
    db.organizationFeatureOverride.findMany({ where: { organizationId } }),
    loadPlatformOff(db),
  ])
  return resolveFeatures({ plan, overrides, platformOff })
}

// Set of feature keys switched OFF for the organization (cached briefly —
// this runs on every module-gated request).
async function disabledFeatureKeys(organizationId) {
  const hit = cache.get(organizationId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const features = await getOrganizationFeatures(organizationId)
  const value = new Set(features.filter((f) => !f.enabled).map((f) => f.key))
  cache.set(organizationId, { at: Date.now(), value })
  return value
}

// Module keys (ROLE_MODULES) that the organization is NOT entitled to.
async function disabledModuleKeys(organizationId) {
  const off = await disabledFeatureKeys(organizationId)
  return Object.keys(FEATURE_BY_MODULE).filter((m) => off.has(FEATURE_BY_MODULE[m]))
}

// Entitlement lookups fail OPEN: a missing table (migration not deployed yet)
// or a database blip must not turn every module into a 403.
async function safeDisabledFeatureKeys(organizationId) {
  try {
    return await disabledFeatureKeys(organizationId)
  } catch (err) {
    if (!warned) {
      warned = true
      console.error("feature entitlement lookup failed — allowing access:", err.message)
    }
    return new Set()
  }
}

async function isModuleEntitled(organizationId, moduleKey) {
  const featureKey = FEATURE_BY_MODULE[moduleKey]
  if (!featureKey) return true // not a gated module
  return !(await safeDisabledFeatureKeys(organizationId)).has(featureKey)
}

async function isFeatureEntitled(organizationId, featureKey) {
  return !(await safeDisabledFeatureKeys(organizationId)).has(featureKey)
}

async function safeDisabledModuleKeys(organizationId) {
  try {
    return await disabledModuleKeys(organizationId)
  } catch {
    return []
  }
}

module.exports = {
  FEATURES,
  FEATURE_KEYS,
  FEATURE_BY_KEY,
  FEATURE_BY_MODULE,
  resolveFeatures,
  loadPlatformOff,
  planFor,
  getOrganizationFeatures,
  clearEntitlementCache,
  isModuleEntitled,
  isFeatureEntitled,
  safeDisabledModuleKeys,
}
