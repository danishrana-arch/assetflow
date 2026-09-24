export const MANAGEMENT_ROLES = [
  "ADMIN",
  "CEO",
  "HR",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
]

export const ROLE_LABELS = {
  CEO: "CEO",
  ADMIN: "Admin",
  HR: "HR",
  MANAGEMENT: "Management",
  DEPARTMENT_HEAD: "Department Head",
  IT_MANAGER: "IT Manager",
  EMPLOYEE: "Employee",
}

// Canonical role -> module map — the single source of truth for what nav
// links and pages/routes each role can reach. Mirrored by hand in
// backend/src/utils/roles.js (there's no shared package between the two
// apps, so keep the two in sync). "*" means unrestricted.
//
// IT_MANAGER is deliberately inventory-only: no employee directory, no
// payroll, no leave/attendance admin, nothing outside these five modules.
//
// "sales", "salesTeam", and "salesReports" were removed 2026-09-23 along
// with the SALES_HEAD role itself (see UserRole enum in schema.prisma) —
// this deployment is HR-only, no sales pipeline feature was ever going to
// be built. "financialReports" was removed the same day. "hrReports" was
// removed and then restored the same day at the user's request — HR
// Reports is a real part of the app. "payrollReports" is kept (Payroll
// Reports page, still a placeholder).
// The MANAGER role ("Finance Manager") was removed entirely on 2026-09-24
// (see UserRole enum) — ADMIN/CEO already cover payroll/payrollReports via
// the "*" wildcard.
export const ROLE_MODULES = {
  CEO: ["*"],
  ADMIN: ["*"],
  HR: ["employees", "employeeForms", "certifications", "attendance", "leave", "hrReports"],
  MANAGEMENT: ["employees", "projects", "tasks", "attendance", "performance", "reports"],
  DEPARTMENT_HEAD: ["departments", "employees", "attendance", "projects", "tasks", "leave"],
  IT_MANAGER: ["inventory", "assets", "assetAssignments", "assetRequests", "tickets"],
  EMPLOYEE: [],
}

export function hasModuleAccess(role, moduleKey) {
  const modules = ROLE_MODULES[role]
  if (!modules) return false
  return modules.includes("*") || modules.includes(moduleKey)
}

export function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}

export function canAccessPayroll(role) {
  return hasModuleAccess(role, "payroll")
}

// IT_MANAGER's own inventory area (Inventory/Assets/Asset Assignments/Asset
// Requests) — ADMIN/CEO always pass via the wildcard.
export function canManageInventory(role) {
  return hasModuleAccess(role, "inventory")
}

// Gates the Employees directory PAGE/nav link. IT_MANAGER is included even
// though it has no "employees" module — the Sidebar/MobileNav IT nav set
// has always linked here labeled "Employees & Assets", and the backend
// (GET /employees) already redacts the response for that role down to
// name/email/phone/role/status/photo/designation/department/assignedAssets
// (see stripForIT in employee.controller.js) — this is IT's asset-
// assignment view of who has what, not an HR-style directory. See
// EMPLOYEE_DIRECTORY_ROLES in backend/src/utils/roles.js for the matching
// API-side exception.
export function canViewEmployeeDirectory(role) {
  return hasModuleAccess(role, "employees") || role === "IT_MANAGER"
}
