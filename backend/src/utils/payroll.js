// Shared payslip math, used by both the payroll and expense-claim
// controllers so a payslip's totals are always derived the same way.

function toNumber(decimal) {
  return decimal === null || decimal === undefined ? 0 : Number(decimal)
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// `deductions` is the total of every deduction line; netPay never goes
// below zero.
function computePayrollTotals(r) {
  const deductions = round2(
    toNumber(r.tax) +
      toNumber(r.absentDeduction) +
      toNumber(r.lateDeduction) +
      toNumber(r.otherDeduction) +
      toNumber(r.terminationDeduction)
  )
  const additions =
    toNumber(r.baseSalary) +
    toNumber(r.bonus) +
    toNumber(r.performanceBonus) +
    toNumber(r.expenseReimbursement) +
    toNumber(r.terminationSettlement)
  return { deductions, netPay: Math.max(0, round2(additions - deductions)) }
}

// Sum of an employee's performance-review bonuses assigned to a payroll month.
async function performanceBonusTotal(db, employeeId, month, year) {
  const agg = await db.performanceReview.aggregate({
    where: { employeeId, bonusPayrollMonth: month, bonusPayrollYear: year },
    _sum: { bonusAmount: true },
  })
  return round2(toNumber(agg._sum.bonusAmount))
}

// Same as syncExpenseReimbursement, for performance bonuses.
async function syncPerformanceBonus(db, employeeId, month, year) {
  const record = await db.payrollRecord.findUnique({
    where: { employeeId_month_year: { employeeId, month, year } },
  })
  if (!record || record.status !== "DRAFT") return null
  const performanceBonus = await performanceBonusTotal(db, employeeId, month, year)
  return db.payrollRecord.update({
    where: { id: record.id },
    data: { performanceBonus, ...computePayrollTotals({ ...record, performanceBonus }) },
  })
}

// Sum of an employee's approved expense claims assigned to a payroll month.
async function approvedExpenseTotal(db, employeeId, month, year) {
  const agg = await db.expenseClaim.aggregate({
    where: { employeeId, status: "APPROVED", payrollMonth: month, payrollYear: year },
    _sum: { amount: true },
  })
  return round2(toNumber(agg._sum.amount))
}

// Re-derives a month's expense reimbursement (and totals) on the payslip,
// if one exists and is still DRAFT. A submitted or paid payslip is left
// alone — claims are never assigned to one (see pickPayrollMonthForClaim).
async function syncExpenseReimbursement(db, employeeId, month, year) {
  const record = await db.payrollRecord.findUnique({
    where: { employeeId_month_year: { employeeId, month, year } },
  })
  if (!record || record.status !== "DRAFT") return null
  const expenseReimbursement = await approvedExpenseTotal(db, employeeId, month, year)
  return db.payrollRecord.update({
    where: { id: record.id },
    data: { expenseReimbursement, ...computePayrollTotals({ ...record, expenseReimbursement }) },
  })
}

// An approved claim goes onto the payslip for the month the expense was
// made in — unless that payslip is already submitted or paid, in which
// case it rolls forward to the next month whose payslip is still open.
async function pickPayrollMonthForClaim(db, employeeId, expenseDate) {
  let month = expenseDate.getUTCMonth() + 1
  let year = expenseDate.getUTCFullYear()
  for (let i = 0; i < 36; i += 1) {
    const record = await db.payrollRecord.findUnique({
      where: { employeeId_month_year: { employeeId, month, year } },
      select: { status: true },
    })
    if (!record || record.status === "DRAFT") break
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return { month, year }
}

module.exports = {
  toNumber,
  round2,
  computePayrollTotals,
  approvedExpenseTotal,
  syncExpenseReimbursement,
  pickPayrollMonthForClaim,
  performanceBonusTotal,
  syncPerformanceBonus,
}
