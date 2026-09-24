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
const ROLE_MODULES = {
  CEO: ["*"],
  ADMIN: ["*"],
  HR: ["employees", "employeeForms", "certifications", "attendance", "leave", "hrReports"],
  MANAGEMENT: ["employees", "projects", "tasks", "attendance", "performance", "reports"],
  DEPARTMENT_HEAD: ["departments", "employees", "attendance", "projects", "tasks", "leave"],
  IT_MANAGER: ["inventory", "assets", "assetAssignments", "assetRequests", "tickets"],
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

function hasModuleAccess(role, moduleKey) {
  return hasModuleAccessImpl(role, moduleKey)
}

function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

module.exports = {
  MANAGEMENT_ROLES,
  ASSIGNABLE_ROLES,
  EMPLOYEE_DIRECTORY_ROLES,
  MAX_CEO_COUNT,
  ROLE_MODULES,
  hasModuleAccess,
  isManagement,
}
