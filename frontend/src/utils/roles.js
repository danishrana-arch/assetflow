export const MANAGEMENT_ROLES = [
  "ADMIN",
  "CEO",
  "MANAGER",
  "SALES_HEAD",
  "HR",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
]

export const ROLE_LABELS = {
  CEO: "CEO",
  ADMIN: "Admin",
  HR: "HR",
  MANAGER: "Finance Manager",
  SALES_HEAD: "Sales Head",
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
export const ROLE_MODULES = {
  CEO: ["*"],
  ADMIN: ["*"],
  MANAGER: ["payroll", "payrollReports", "financialReports"],
  HR: ["employees", "employeeForms", "certifications", "attendance", "leave", "hrReports"],
  SALES_HEAD: ["sales", "salesTeam", "projects", "tasks", "salesReports"],
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
// Requests) — ADMIN/CEO always pass via the wildcard. MANAGER (Finance
// Manager) is deliberately excluded: Inventory isn't one of its modules.
export function canManageInventory(role) {
  return hasModuleAccess(role, "inventory")
}

// Gates the standalone Employees directory PAGE/nav link. IT_MANAGER is
// deliberately excluded here even though the backend still lets it call
// GET /employees — that's only for the redacted asset-assignment picker on
// the Assignments page, not for opening the directory page itself. See
// EMPLOYEE_DIRECTORY_ROLES in backend/src/utils/roles.js.
export function canViewEmployeeDirectory(role) {
  return hasModuleAccess(role, "employees")
}
