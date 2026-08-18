export const MANAGEMENT_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "Dept-Head"]

export const ROLE_LABELS = {
  ADMIN: "Owner / Admin",
  CEO: "CEO",
  SALES_HEAD: "Sales Head",
  HR: "HR",
  MANAGEMENT: "Management",
  EMPLOYEE: "Employee",
  "Dept-Head": "Department Head",
}

export function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}
