export const MANAGEMENT_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]
export const PAYROLL_ROLES = ["ADMIN", "CEO", "HR"]
export const INVENTORY_ROLES = ["ADMIN", "CEO", "HR", "IT_MANAGER"]
export const EMPLOYEE_DIRECTORY_ROLES = [...MANAGEMENT_ROLES, "IT_MANAGER"]

export const ROLE_LABELS = {
  ADMIN: "Owner / Admin",
  CEO: "CEO",
  SALES_HEAD: "Sales Head",
  HR: "HR",
  MANAGEMENT: "Management",
  DEPARTMENT_HEAD: "Department Head",
  IT_MANAGER: "IT Manager",
  EMPLOYEE: "Employee",
  // Legacy value kept for existing accounts until they are migrated manually.
  MANAGER: "Manager",
}

export function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

export function canAccessPayroll(role) {
  return PAYROLL_ROLES.includes(role)
}

export function canManageInventory(role) {
  return INVENTORY_ROLES.includes(role)
}

export function canViewEmployeeDirectory(role) {
  return EMPLOYEE_DIRECTORY_ROLES.includes(role)
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}
