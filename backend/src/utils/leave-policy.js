const prisma = require("../lib/prisma")
const { toDateOnly } = require("./date")

// Leave rules for Permanent employees:
// - Only PERMANENT employees may apply.
// - Monthly schedule (cumulative, per calendar year): the first eligible
//   month allows 1 day in total, the next 2, … — so a whole-year Permanent
//   employee gets Jan 1 … Dec 12. The first eligible month is January, or
//   the permanentDate's month in the year they became Permanent (no
//   retroactive months). Resets every January.
// - Pending (either stage) and approved leave both count, so splitting a
//   request into several can't get round the cap.
// - Annual balance (org sick/casual allowance) is a separate check.

const PENDING_LEAVE_STATUSES = ["PENDING_HR", "PENDING_FINAL_APPROVAL"]
const ACTIVE_LEAVE_STATUSES = [...PENDING_LEAVE_STATUSES, "APPROVED"]
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const NOT_PERMANENT_MESSAGE = "Leave applications are available after your employment status becomes Permanent."

function dayKey(date) {
  return toDateOnly(date).toISOString().slice(0, 10)
}

// First month (1-12) of `year` with leave entitlement, or null for none.
function firstEligibleMonth(permanentDate, year) {
  if (!permanentDate) return 1
  const p = toDateOnly(permanentDate)
  if (p.getUTCFullYear() > year) return null
  return p.getUTCFullYear() === year ? p.getUTCMonth() + 1 : 1
}

// Cumulative leave days allowed by the end of `month` (1-12) of `year`.
function monthlyCap(permanentDate, year, month) {
  const first = firstEligibleMonth(permanentDate, year)
  if (first === null || month < first) return 0
  return month - first + 1
}

async function holidaySet(organizationId, start, end) {
  const holidays = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: start, lte: end } },
    select: { date: true },
  })
  return new Set(holidays.map((h) => dayKey(h.date)))
}

// Chargeable leave days per month of `year` ([0] unused, [1..12]) for the
// given leaves — same counting as the balance (holidays skipped, half day
// = 0.5).
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
// balance endpoint and the leave form.
async function leaveSchedule({ organizationId, employee, year, todayKey }) {
  const { start, end } = yearBounds(year)
  const [leaves, holidays] = await Promise.all([
    activeLeavesInYear(employee.id, year),
    holidaySet(organizationId, start, end),
  ])
  const perMonth = daysByMonth(leaves, year, holidays)
  const eligible = employee.employmentStatus === "PERMANENT"
  let cumulative = 0
  const months = MONTH_NAMES.map((name, i) => {
    cumulative += perMonth[i + 1]
    return { month: i + 1, name, cap: eligible ? monthlyCap(employee.permanentDate, year, i + 1) : 0, days: perMonth[i + 1], cumulative }
  })
  const [ty, tm] = String(todayKey).split("-").map(Number)
  const current = ty === year ? months[tm - 1] : null
  return {
    year,
    eligible,
    employmentStatus: employee.employmentStatus,
    permanentDate: employee.permanentDate,
    message: eligible ? null : NOT_PERMANENT_MESSAGE,
    months,
    currentMonth: current
      ? { month: current.month, name: current.name, cap: current.cap, used: current.cumulative, remaining: Math.max(0, current.cap - current.cumulative) }
      : null,
  }
}

const fmtDays = (n) => `${n} leave day${n === 1 ? "" : "s"}`

// Every server-side check before a leave request is created. Returns null
// when it's fine, or { status, error }.
async function validateLeaveRequest({ organizationId, employee, start, end, isHalfDay, type, todayKey, allowance }) {
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

  const request = { startDate: start, endDate: end, isHalfDay, type }
  let requestedTotal = 0
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    const { start: ys, end: ye } = yearBounds(year)
    const [existing, holidays] = await Promise.all([activeLeavesInYear(employee.id, year), holidaySet(organizationId, ys, ye)])
    const before = daysByMonth(existing, year, holidays)
    const requested = daysByMonth([request], year, holidays)
    requestedTotal += requested.reduce((a, b) => a + b, 0)

    // Monthly schedule: cumulative days by the end of each month the
    // request touches (and every later month) must stay within that
    // month's cap. Earlier months are unaffected by this request.
    const firstTouched = requested.findIndex((d, m) => m > 0 && d > 0)
    if (firstTouched === -1) continue
    let cumulative = 0
    for (let m = 1; m <= 12; m++) {
      cumulative += before[m] + requested[m]
      if (m < firstTouched) continue
      const cap = monthlyCap(employee.permanentDate, year, m)
      if (cumulative > cap) {
        const already = cumulative - requested.slice(1, m + 1).reduce((a, b) => a + b, 0)
        return {
          status: 400,
          error: cap === 0
            ? `You have no leave allowance in ${MONTH_NAMES[m - 1]} ${year} yet — it starts from the month you became Permanent.`
            : `You cannot take more than ${fmtDays(cap)} by the end of ${MONTH_NAMES[m - 1]} ${year}` +
              ` (you already have ${fmtDays(already)} requested or approved this year).` +
              " Your monthly leave allowance increases according to the leave schedule.",
        }
      }
    }

    // Annual balance for paid types — separate from the monthly schedule.
    const bucketTotal = allowance?.[type]
    if (bucketTotal != null) {
      const usedOfType = daysByMonth(existing.filter((l) => l.type === type), year, holidays).reduce((a, b) => a + b, 0)
      const requestedYear = requested.reduce((a, b) => a + b, 0)
      if (usedOfType + requestedYear > bucketTotal) {
        const left = Math.max(0, bucketTotal - usedOfType)
        return { status: 400, error: `Not enough ${type === "SICK" ? "sick" : "annual"} leave left for ${year}: ${fmtDays(left)} remaining of ${bucketTotal}, this request needs ${requestedYear}.` }
      }
    }
  }
  if (requestedTotal === 0) return { status: 400, error: "These dates are all company holidays — there's nothing to request." }
  return null
}

module.exports = {
  PENDING_LEAVE_STATUSES,
  ACTIVE_LEAVE_STATUSES,
  NOT_PERMANENT_MESSAGE,
  monthlyCap,
  leaveSchedule,
  validateLeaveRequest,
}
