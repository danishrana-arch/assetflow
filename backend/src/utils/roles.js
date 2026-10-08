const { AsyncLocalStorage } = require("node:async_hooks")

const MANAGEMENT_ROLES = [
  "ADMIN",
  "CEO",
  "HR",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
]

const ASSIGNABLE_ROLES = [
  "ADMIN",
  "CEO",
  "HR",
  "MANAGEMENT",
  "EMPLOYEE",
  "DEPARTMENT_HEAD",
  "IT_MANAGER",
  "SITE_ADMIN",
]

// The CEO is capped at three per organization.
const MAX_CEO_COUNT = 3

// Canonical role -> module map. This is the single source of truth for what
// each role can reach, both in the frontend nav/route guards (see the
// mirrored copy in frontend/src/utils/roles.js — the two must be kept in
// sync by hand, there's no shared package between the two apps) and in the
// backend's requireModule()/requireModuleOrSelf() middleware below.
// "*" means unrestricted — every module, every role-gated action.
//
// IT_MANAGER is deliberately inventory-only: no employee directory, no
// payroll, no leave/attendance admin, nothing outside these five. ADMIN and
// CEO always get "*" — a main-company ADMIN/IT_MANAGER can additionally
// switch into other organizations in the company (see applyOrganizationScope
// in auth.middleware.js), but within whichever org they're viewing, module
// access is still governed by this map.
// "sales", "salesTeam", and "salesReports" were removed 2026-09-23 along
// with the SALES_HEAD role itself (see UserRole enum) — this deployment is
// HR-only, no sales pipeline feature was ever going to be built.
// "financialReports" was removed the same day. "hrReports" was removed and
// then restored the same day at the user's request — HR Reports is a real
// part of the app. "payrollReports" is kept (Payroll Reports page, still a
// placeholder).
// The MANAGER role ("Finance Manager") was removed entirely on 2026-09-24
// (see UserRole enum) — 0 live users held it, so no reassignment was
// needed. ADMIN/CEO already cover payroll/payrollReports via the "*"
// wildcard, so nothing else needed to pick those modules up.
// "expenseClaims" = reviewing employees' office-expense claims (HR, plus
// ADMIN/CEO via "*"). Submitting your own claim needs no module.
const ROLE_MODULES = {
  CEO: ["*"],
  ADMIN: ["*"],
  HR: ["employees", "employeeForms", "certifications", "attendance", "leave", "hrReports", "expenseClaims", "payroll", "payrollReports"],
  MANAGEMENT: ["employees", "projects", "tasks", "attendance", "performance", "reports"],
  DEPARTMENT_HEAD: ["departments", "employees", "attendance", "projects", "tasks", "leave"],
  IT_MANAGER: ["inventory", "assets", "assetAssignments", "assetRequests", "tickets"],
  // Site Admin / Project Manager: marks attendance only for the employees of
  // the sites assigned to them (AttendanceSiteAdmin) — not a global admin.
  SITE_ADMIN: ["siteAttendance"],
  // Platform administration lives in the Control Center (utils/platform.js),
  // not in the company module tree — no company modules.
  PLATFORM_ADMIN: [],
  EMPLOYEE: [],
}

// Roles allowed to open employee profiles and directory records.
// Regular employees can still open only their own profile. IT_MANAGER is
// included here even though it has no "employees" module: it needs a
// picker of who an asset can be assigned to, and getEmployee/listEmployees
// already redact everything but name/email/phone/role/status/photo/
// designation/department/assignedAssets for that role — this is an
// asset-assignment concern, not directory/HR access.
const EMPLOYEE_DIRECTORY_ROLES = [
  ...Object.keys(ROLE_MODULES).filter((role) => hasModuleAccessImpl(role, "employees")),
  "IT_MANAGER",
]

function hasModuleAccessImpl(role, moduleKey) {
  const modules = ROLE_MODULES[role]
  if (!modules) return false
  return modules.includes("*") || modules.includes(moduleKey)
}

// Every module key a role can be given (what a Control Center custom role picks from).
const ALL_MODULE_KEYS = [...new Set(Object.values(ROLE_MODULES).flat().filter((m) => m !== "*"))].sort()

// A user with a Control Center custom role has THAT role's module list instead
// of their base role's. requireAuth runs the rest of the request inside this
// store ({ role: baseRole, customModules }) so the ~28 existing
// hasModuleAccess(req.user.role, …) calls honour it without being edited. It
// only applies when the role asked about is the requester's own base role.
const accessStore = new AsyncLocalStorage()

function runWithAccess(store, fn) {
  return accessStore.run(store, fn)
}

// Module access for a role as defined in code — never affected by custom
// roles (use this when iterating over roles, e.g. to pick notification recipients).
function roleHasModule(role, moduleKey) {
  return hasModuleAccessImpl(role, moduleKey)
}

function hasModuleAccess(role, moduleKey) {
  const store = accessStore.getStore()
  if (store?.customModules && store.role === role) return store.customModules.includes(moduleKey)
  return hasModuleAccessImpl(role, moduleKey)
}

// Same check for an explicit req.user (no reliance on the request store).
function userHasModule(user, moduleKey) {
  if (!user) return false
  if (user.customModules) return user.customModules.includes(moduleKey)
  return hasModuleAccessImpl(user.role, moduleKey)
}

function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

// Only these roles can be someone's Reporting Manager (mirrored in
// frontend/src/utils/roles.js).
const REPORTING_MANAGER_ROLES = ["ADMIN", "CEO", "DEPARTMENT_HEAD"]

// Who may be picked as a Reporting Manager: an ADMIN / DEPARTMENT_HEAD of
// this organization, or a CEO of this organization or the company root, who
// hasn't left the company.
function reportingManagerWhere({ organizationId, companyId }) {
  return {
    status: { not: "LEFT_COMPANY" },
    OR: [
      { organizationId, role: { in: REPORTING_MANAGER_ROLES } },
      { organizationId: companyId || organizationId, role: "CEO" },
    ],
  }
}

module.exports = {
  REPORTING_MANAGER_ROLES,
  reportingManagerWhere,
  MANAGEMENT_ROLES,
  ASSIGNABLE_ROLES,
  EMPLOYEE_DIRECTORY_ROLES,
  MAX_CEO_COUNT,
  ROLE_MODULES,
  ALL_MODULE_KEYS,
  runWithAccess,
  roleHasModule,
  userHasModule,
  hasModuleAccess,
  isManagement,
}
