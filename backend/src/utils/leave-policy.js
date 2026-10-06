const prisma = require("../lib/prisma")
const { toDateOnly } = require("./date")

// Pro-rata leave policy.
// - Paid leave is one yearly pool (Organization.annualLeaveEntitlement,
//   default 30 days) shared by SICK, CASUAL and ANNUAL leave. It is earned
//   month by month: 30 / 12 = 2.5 days per month, cumulative — January 2.5,
//   February 5, March 7.5, … December 30. Resets every January (no carry
//   forward).
// - Pro-rata from the joining month: someone who joins in June earns from
//   June only (7 months x 2.5 = 17.5 days that year). Joining date, else
//   start date; with neither set, the employee is treated as already
//   employed and earns from January. The joining month counts in full.
// - Each type also has its own yearly limit, pro-rated the same way:
//   sick = sickLeaveAllowance, casual = casualLeaveAllowance, annual = the
//   rest of the pool. A request must fit both the type limit and the pool.
// - By the end of each month, paid leave taken (pending + approved) can't be
//   more than what has been earned by then — so splitting a request, or
//   booking ahead, can't get round it. A December trip can be booked in
//   February, but only against what will have been earned by December.
// - UNPAID leave doesn't use the pool (no limit; payroll deducts it).
// - Only PERMANENT employees may apply, and not for days before their
//   Permanent date (they keep everything earned during probation).

const PENDING_LEAVE_STATUSES = ["PENDING_HR", "PENDING_FINAL_APPROVAL"]
const ACTIVE_LEAVE_STATUSES = [...PENDING_LEAVE_STATUSES, "APPROVED"]
const PAID_LEAVE_TYPES = ["SICK", "CASUAL", "ANNUAL"]
const LEAVE_TYPE_NAMES = { SICK: "sick", CASUAL: "casual", ANNUAL: "annual", UNPAID: "unpaid" }
const DEFAULT_ENTITLEMENT = 30
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const NOT_PERMANENT_MESSAGE = "Leave applications are available after your employment status becomes Permanent."

const round2 = (n) => Math.round(n * 100) / 100
const floorHalf = (n) => Math.floor(n * 2 + 1e-9) / 2

function dayKey(date) {
  return toDateOnly(date).toISOString().slice(0, 10)
}

// Yearly allowances from the organization: { total, SICK, CASUAL, ANNUAL }.
function leaveAllowances(org) {
  const total = Number.isFinite(Number(org?.annualLeaveEntitlement)) ? Number(org.annualLeaveEntitlement) : DEFAULT_ENTITLEMENT
  const sick = Math.min(Number(org?.sickLeaveAllowance ?? 8), total)
  const casual = Math.min(Number(org?.casualLeaveAllowance ?? 6), Math.max(0, total - sick))
  return { total, SICK: sick, CASUAL: casual, ANNUAL: Math.max(0, total - sick - casual) }
}

function accrualStartDate(employee) {
  return employee?.joiningDate || employee?.startDate || null
}

// First month (1-12) of `year` that earns leave, or null for none.
function firstAccrualMonth(employee, year) {
  const start = accrualStartDate(employee)
  if (!start) return 1
  const d = toDateOnly(start)
  if (d.getUTCFullYear() > year) return null
  return d.getUTCFullYear() === year ? d.getUTCMonth() + 1 : 1
}

// Months of `year` that earn leave (0-12).
function accrualMonths(employee, year) {
  const first = firstAccrualMonth(employee, year)
  return first === null ? 0 : 12 - first + 1
}

// Leave earned by the end of `month` (1-12) of `year`, cumulative.
function accruedBy(employee, year, month, total) {
  const first = firstAccrualMonth(employee, year)
  if (first === null || month < first) return 0
  return round2(((month - first + 1) * total) / 12)
}

// One type's limit for `year`, pro-rated to the months that earn leave
// (sick/casual rounded down to a half day; annual gets the rest of the
// year's pool, so the three always add up to it).
function typeLimit(allowances, type, employee, year) {
  const prorate = (n) => floorHalf((n * accrualMonths(employee, year)) / 12)
  if (type !== "ANNUAL") return prorate(allowances[type])
  const pool = accruedBy(employee, year, 12, allowances.total)
  return Math.max(0, round2(pool - prorate(allowances.SICK) - prorate(allowances.CASUAL)))
}

async function holidaySet(organizationId, start, end) {
  const holidays = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: start, lte: end } },
    select: { date: true },
  })
  return new Set(holidays.map((h) => dayKey(h.date)))
}

// Chargeable leave days per month of `year` ([0] unused, [1..12]) for the
// given leaves — holidays skipped, half day = 0.5.
function daysByMonth(leaves, year, holidays) {
  const months = new Array(13).fill(0)
  for (const leave of leaves) {
    const start = toDateOnly(leave.startDate)
    const end = toDateOnly(leave.endDate)
    if (leave.isHalfDay) {
      if (start.getUTCFullYear() === year && !holidays.has(dayKey(start))) months[start.getUTCMonth() + 1] += 0.5
      continue
    }
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCFullYear() !== year || holidays.has(dayKey(d))) continue
      months[d.getUTCMonth() + 1] += 1
    }
  }
  return months
}

const sum = (arr) => arr.reduce((a, b) => a + b, 0)

function yearBounds(year) {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) }
}

async function activeLeavesInYear(employeeId, year, excludeLeaveId) {
  const { start, end } = yearBounds(year)
  return prisma.leaveApplication.findMany({
    where: {
      employeeId,
      status: { in: ACTIVE_LEAVE_STATUSES },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
    },
    select: { id: true, type: true, status: true, startDate: true, endDate: true, isHalfDay: true },
  })
}

// The month-by-month picture for one employee and year — used by the
// balance endpoint and the leave form. `org` needs annualLeaveEntitlement,
// sickLeaveAllowance, casualLeaveAllowance.
async function leaveSchedule({ organizationId, employee, org, year, todayKey }) {
  const { start, end } = yearBounds(year)
  const [leaves, holidays] = await Promise.all([activeLeavesInYear(employee.id, year), holidaySet(organizationId, start, end)])
  const allowances = leaveAllowances(org)
  const paid = leaves.filter((l) => PAID_LEAVE_TYPES.includes(l.type))
  const perMonth = daysByMonth(paid, year, holidays)
  const eligible = employee.employmentStatus === "PERMANENT"

  let cumulative = 0
  const months = MONTH_NAMES.map((name, i) => {
    cumulative += perMonth[i + 1]
    const accrued = accruedBy(employee, year, i + 1, allowances.total)
    // `cap` kept as an alias of `accrued` for older clients.
    return { month: i + 1, name, accrued, cap: accrued, days: perMonth[i + 1], cumulative }
  })

  const types = {}
  for (const type of PAID_LEAVE_TYPES) {
    const used = sum(daysByMonth(paid.filter((l) => l.type === type), year, holidays))
    const total = typeLimit(allowances, type, employee, year)
    types[type] = { total, fullYear: allowances[type], used, remaining: Math.max(0, round2(total - used)) }
  }

  const [ty, tm] = String(todayKey).split("-").map(Number)
  const current = ty === year ? months[tm - 1] : ty > year ? months[11] : null
  const yearEntitlement = accruedBy(employee, year, 12, allowances.total)
  const usedThisYear = sum(perMonth)
  return {
    year,
    eligible,
    employmentStatus: employee.employmentStatus,
    permanentDate: employee.permanentDate,
    accrualStartDate: accrualStartDate(employee),
    accrualStartMonth: firstAccrualMonth(employee, year),
    message: eligible ? null : NOT_PERMANENT_MESSAGE,
    entitlement: allowances.total,
    monthlyRate: round2(allowances.total / 12),
    yearEntitlement,
    used: usedThisYear,
    remainingThisYear: Math.max(0, round2(yearEntitlement - usedThisYear)),
    types,
    months,
    currentMonth: current
      ? {
          month: current.month,
          name: current.name,
          accrued: current.accrued,
          cap: current.accrued,
          used: current.cumulative,
          remaining: Math.max(0, round2(current.accrued - current.cumulative)),
        }
      : null,
  }
}

const fmtDays = (n) => `${round2(n)} day${n === 1 ? "" : "s"}`

// Every server-side check before a leave request is created. Returns null
// when it's fine, or { status, error }.
async function validateLeaveRequest({ organizationId, employee, org, start, end, isHalfDay, type, todayKey }) {
  if (employee.employmentStatus !== "PERMANENT") return { status: 403, error: NOT_PERMANENT_MESSAGE }

  const currentYear = Number(String(todayKey).slice(0, 4))
  if (start.getUTCFullYear() < currentYear || end.getUTCFullYear() > currentYear + 1) {
    return { status: 400, error: `Leave can only be requested for ${currentYear}${end.getUTCFullYear() > currentYear ? ` or ${currentYear + 1}` : ""}.` }
  }
  if (employee.permanentDate && start < toDateOnly(employee.permanentDate)) {
    return { status: 400, error: `Leave can't start before your Permanent date (${dayKey(toDateOnly(employee.permanentDate))}).` }
  }

  // Overlap with (or an exact repeat of) one of the employee's own requests.
  const overlap = await prisma.leaveApplication.findFirst({
    where: { employeeId: employee.id, status: { in: ACTIVE_LEAVE_STATUSES }, startDate: { lte: end }, endDate: { gte: start } },
    select: { startDate: true, endDate: true, status: true },
  })
  if (overlap) {
    const same = dayKey(overlap.startDate) === dayKey(start) && dayKey(overlap.endDate) === dayKey(end)
    const state = overlap.status === "APPROVED" ? "approved" : "pending"
    return {
      status: 409,
      error: same
        ? `You already have a ${state} leave request for these dates.`
        : `You already have a ${state} leave request (${dayKey(overlap.startDate)} to ${dayKey(overlap.endDate)}) that overlaps these dates.`,
    }
  }

  const allowances = leaveAllowances(org)
  const isPaid = PAID_LEAVE_TYPES.includes(type)
  const request = { startDate: start, endDate: end, isHalfDay, type }
  let requestedTotal = 0
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    const { start: ys, end: ye } = yearBounds(year)
    const [existing, holidays] = await Promise.all([activeLeavesInYear(employee.id, year), holidaySet(organizationId, ys, ye)])
    const requested = daysByMonth([request], year, holidays)
    const requestedYear = sum(requested)
    requestedTotal += requestedYear
    if (!isPaid || requestedYear === 0) continue

    const paidExisting = existing.filter((l) => PAID_LEAVE_TYPES.includes(l.type))
    const before = daysByMonth(paidExisting, year, holidays)

    // 1. Type limit for the year (pro-rated).
    const limit = typeLimit(allowances, type, employee, year)
    const usedOfType = sum(daysByMonth(paidExisting.filter((l) => l.type === type), year, holidays))
    if (usedOfType + requestedYear > limit) {
      const left = Math.max(0, round2(limit - usedOfType))
      return {
        status: 400,
        error:
          `Not enough ${LEAVE_TYPE_NAMES[type]} leave for ${year}: ${fmtDays(left)} left of ${fmtDays(limit)}` +
          `${limit < allowances[type] ? ` (pro-rated from ${allowances[type]} for the months since you joined)` : ""}, this request needs ${fmtDays(requestedYear)}.` +
          " You can choose another leave type or Unpaid.",
      }
    }

    // 2. Pool earned so far: by the end of every month from the first one
    // this request touches, paid days taken can't exceed what's earned.
    const firstTouched = requested.findIndex((d, m) => m > 0 && d > 0)
    let cumulative = 0
    for (let m = 1; m <= 12; m++) {
      cumulative += before[m] + requested[m]
      if (m < firstTouched) continue
      const earned = accruedBy(employee, year, m, allowances.total)
      if (cumulative > earned + 1e-9) {
        const already = round2(cumulative - sum(requested.slice(1, m + 1)))
        return {
          status: 400,
          error: earned === 0
            ? `You haven't earned any paid leave by ${MONTH_NAMES[m - 1]} ${year} yet — leave is earned from your joining month.`
            : `By the end of ${MONTH_NAMES[m - 1]} ${year} you'll have earned ${fmtDays(earned)} of paid leave` +
              ` (${round2(allowances.total / 12)} per month), and you already have ${fmtDays(already)} requested or approved.` +
              ` This request needs ${fmtDays(requestedYear)}. Choose later dates, fewer days, or Unpaid leave.`,
        }
      }
    }
  }
  if (requestedTotal === 0) return { status: 400, error: "These dates are all company holidays — there's nothing to request." }
  return null
}

module.exports = {
  PENDING_LEAVE_STATUSES,
  ACTIVE_LEAVE_STATUSES,
  PAID_LEAVE_TYPES,
  NOT_PERMANENT_MESSAGE,
  leaveAllowances,
  accruedBy,
  typeLimit,
  leaveSchedule,
  validateLeaveRequest,
}
