const MANAGEMENT_ROLES = [
  "ADMIN",
  "CEO",
  "SALES_HEAD",
  "HR",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
]

const ASSIGNABLE_ROLES = [
  "ADMIN",
  "CEO",
  "SALES_HEAD",
  "HR",
  "MANAGEMENT",
  "EMPLOYEE",
  "DEPARTMENT_HEAD",
]

// Roles allowed to open employee profiles and directory records.
// Regular employees can still open only their own profile.
const EMPLOYEE_DIRECTORY_ROLES = [
  "ADMIN",
  "CEO",
  "SALES_HEAD",
  "HR",
  "MANAGEMENT",
  "DEPARTMENT_HEAD",
  "IT_MANAGER",
]

// The CEO is capped at two per organization.
const MAX_CEO_COUNT = 2

function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

module.exports = {
  MANAGEMENT_ROLES,
  ASSIGNABLE_ROLES,
  EMPLOYEE_DIRECTORY_ROLES,
  MAX_CEO_COUNT,
  isManagement,
}