const MANAGEMENT_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]

const ASSIGNABLE_ROLES = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "EMPLOYEE", "DEPARTMENT_HEAD"]

// The CEO is the top authority (org settings, payroll approval/payout,
// the disbursement bank account) — capped at 2 per org so that authority
// stays concentrated. Enforced in employee.controller.js (role edits) and
// auth.controller.js (inviting a new CEO).
const MAX_CEO_COUNT = 2

function isManagement(role) {
  return MANAGEMENT_ROLES.includes(role)
}

module.exports = { MANAGEMENT_ROLES, ASSIGNABLE_ROLES, MAX_CEO_COUNT, isManagement }
