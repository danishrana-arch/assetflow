// Role groups are intentionally separated from one broad "management" bucket.
// This lets each role see only the modules it is responsible for.
const MANAGEMENT_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]
const ASSIGNABLE_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "IT_MANAGER", "EMPLOYEE"]
const PAYROLL_ROLES = ["ADMIN", "CEO", "HR"]
const INVENTORY_ROLES = ["ADMIN", "CEO", "HR", "IT_MANAGER"]
const EMPLOYEE_DIRECTORY_ROLES = [...MANAGEMENT_ROLES, "IT_MANAGER"]
const MAX_CEO_COUNT = 2

function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

function canAccessPayroll(role) {
  return PAYROLL_ROLES.includes(role)
}

function canManageInventory(role) {
  return INVENTORY_ROLES.includes(role)
}

function canViewEmployeeDirectory(role) {
  return EMPLOYEE_DIRECTORY_ROLES.includes(role)
}

module.exports = {
  MANAGEMENT_ROLES,
  ASSIGNABLE_ROLES,
  PAYROLL_ROLES,
  INVENTORY_ROLES,
  EMPLOYEE_DIRECTORY_ROLES,
  MAX_CEO_COUNT,
  isManagement,
  canAccessPayroll,
  canManageInventory,
  canViewEmployeeDirectory,
}
