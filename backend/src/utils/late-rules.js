// Company late-arrival rules (LatePolicyRule) — e.g. "every 3 late arrivals
// in a month count as a half day". Shared by payroll (salary part) and the
// leave policy (leave-balance part) so both always agree.
//
// Per employee and calendar month:
// - Late arrivals = LATE attendance days whose fine wasn't waived and that
//   aren't already a HALF_DAY / EARLY_GOING day (those carry their own
//   deduction) — the same days payroll would charge the per-late fine for.
// - Active rules run largest lateCount first; each uses up its late
//   arrivals: with "6 = full day" and "3 = half day", 7 lates = one full day
//   (1 left over, charged the normal late fine).
// - deductFrom LEAVE: taken from the annual leave balance (pro-rata pool);
//   whatever doesn't fit goes to salary. deductFrom SALARY: always salary.
// - Salary amount: full day = Organization.absentFineAmount (the day rate);
//   half day = day rate x halfDayDeductionPercent / 100. No day rate set =
//   no salary deduction (same as absent days).

const RESULTS = { HALF_DAY: 0.5, FULL_DAY: 1 }
// Every new company starts with this rule (also back-filled by migration
// 20261006150000_late_policy_rules); companies change or delete it.
const DEFAULT_LATE_RULE = { name: "3 late arrivals = half day", lateCount: 3, result: "HALF_DAY", deductFrom: "LEAVE", replaceLateFine: true }
const DEDUCT_FROM = ["LEAVE", "SALARY"]
const round2 = (n) => Math.round(n * 100) / 100
const num = (v) => (v === null || v === undefined ? 0 : Number(v))

async function activeLateRules(db, organizationId) {
  const rules = await db.latePolicyRule.findMany({ where: { organizationId, active: true } })
  return rules.sort((a, b) => b.lateCount - a.lateCount || a.createdAt - b.createdAt)
}

// Chargeable late arrivals per month of `year` ([0] unused, [1..12]).
async function monthlyLateCounts(db, employeeId, year) {
  const start = new Date(Date.UTC(year, 0, 1))
  const end = new Date(Date.UTC(year + 1, 0, 1))
  const [late, fines] = await Promise.all([
    db.attendanceRecord.findMany({
      where: { employeeId, status: "LATE", date: { gte: start, lt: end } },
      select: { date: true, dayType: true },
    }),
    db.attendanceFine.findMany({ where: { employeeId, waived: true, date: { gte: start, lt: end } }, select: { date: true } }),
  ])
  const waived = new Set(fines.map((f) => f.date.toISOString().slice(0, 10)))
  const months = new Array(13).fill(0)
  for (const r of late) {
    if (r.dayType === "HALF_DAY" || r.dayType === "EARLY_GOING") continue
    if (waived.has(r.date.toISOString().slice(0, 10))) continue
    months[r.date.getUTCMonth() + 1] += 1
  }
  return months
}

// Applies the rules to one month's late count. Returns
// { units: [{ ruleId, name, lates, days, result, deductFrom }], finedLates }
// where finedLates = late arrivals still charged the per-late fine.
function applyLateRules(lateCount, rules) {
  let remaining = lateCount
  let replaced = 0
  const units = []
  for (const rule of rules) {
    if (!rule.lateCount || rule.lateCount < 1) continue
    const times = Math.floor(remaining / rule.lateCount)
    if (times < 1) continue
    const used = times * rule.lateCount
    remaining -= used
    if (rule.replaceLateFine) replaced += used
    for (let i = 0; i < times; i++) {
      units.push({ ruleId: rule.id, name: rule.name, lates: rule.lateCount, days: RESULTS[rule.result] || 0.5, result: rule.result, deductFrom: rule.deductFrom })
    }
  }
  return { units, finedLates: Math.max(0, lateCount - replaced) }
}

// Salary price of `days` of a unit (a half-day unit uses the half-day %).
function unitPrice(unit, days, org) {
  const perDay = num(org?.absentFineAmount)
  if (!perDay || !days) return 0
  if (unit.result === "HALF_DAY") {
    const pct = org?.halfDayDeductionPercent === null || org?.halfDayDeductionPercent === undefined ? 50 : num(org.halfDayDeductionPercent)
    return ((perDay * pct) / 100) * (days / unit.days)
  }
  return perDay * days
}

// The whole year for one employee: which rule units fall in each month,
// which part of LEAVE units the leave balance covers (month by month, in
// order — never more than is earned and left of the annual type), and what
// goes to salary. `leave` = { accruedBy(month), annualLimit, paidByMonth
// ([1..12] pending+approved paid leave days), annualUsed (days of ANNUAL
// leave in the year) }; null = no leave coverage (everything to salary).
function yearLatePenalties({ lateByMonth, rules, org, leave }) {
  const months = []
  let covered = 0 // leave days taken by penalties so far this year
  let paidCumulative = 0
  for (let m = 1; m <= 12; m++) {
    paidCumulative += leave ? leave.paidByMonth[m] || 0 : 0
    const { units, finedLates } = applyLateRules(lateByMonth[m] || 0, rules)
    let leaveDays = 0
    let salaryDays = 0
    let salaryAmount = 0
    for (const unit of units) {
      let fromLeave = 0
      if (unit.deductFrom === "LEAVE" && leave) {
        const poolLeft = leave.accruedBy(m) - paidCumulative - covered
        const typeLeft = leave.annualLimit - leave.annualUsed - covered
        fromLeave = Math.max(0, Math.min(unit.days, poolLeft, typeLeft))
        fromLeave = Math.floor(fromLeave * 2 + 1e-9) / 2 // whole or half days
        covered += fromLeave
      }
      const toSalary = unit.days - fromLeave
      leaveDays += fromLeave
      salaryDays += toSalary
      salaryAmount += unitPrice(unit, toSalary, org)
    }
    months[m] = {
      lates: lateByMonth[m] || 0,
      finedLates,
      units,
      leaveDays: round2(leaveDays),
      salaryDays: round2(salaryDays),
      salaryAmount: round2(salaryAmount),
    }
  }
  return months
}

function describeRule(rule) {
  const what = rule.result === "FULL_DAY" ? "a full day" : "a half day"
  const from = rule.deductFrom === "SALARY" ? "deducted from salary" : "taken from leave (salary if no leave is left)"
  return `Every ${rule.lateCount} late arrival${rule.lateCount === 1 ? "" : "s"} in a month = ${what}, ${from}`
}

module.exports = { DEFAULT_LATE_RULE, RESULTS, DEDUCT_FROM, activeLateRules, monthlyLateCounts, applyLateRules, yearLatePenalties, describeRule }
