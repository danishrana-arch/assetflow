const { toDateOnly } = require("../utils/date")
const { getTimeZone, localDateTimeToUtc, parseHHMM } = require("../utils/timezone")
const { isScheduledWorkday } = require("../utils/work-schedule")
const { shiftStartMinutes } = require("../utils/attendance-rules")

// The one place attendance results are calculated: schedule, late minutes,
// early-going minutes, worked time (with the break counted as office time),
// half-day / early-going eligibility and the deduction. Every write path
// (self check-in/out, offline sync, biometric, admin marking, corrections,
// auto check-out, Site Admin marking) calls applyAttendanceEvaluation(), and
// payroll reads the stored result instead of recalculating it.

const DAY_MS = 86400000
const MINUTES_PER_DAY = 24 * 60

const DEFAULT_POLICY = {
  lateThresholdMinutes: 15,
  lateHalfDayThresholdHours: 3,
  halfDayMinimumHours: 4.5,
  earlyGoingThresholdHours: 2,
  earlyGoingFineAmount: 0,
  halfDayDeductionPercent: 50,
}

// Organization fields the engine needs.
const ENGINE_ORG_SELECT = {
  id: true,
  timezone: true,
  shiftStartDefault: true,
  shiftEndDefault: true,
  workingHoursPerDay: true,
  workingDaysPerWeek: true, workingDays: true,
  breakStart: true,
  breakEnd: true,
  lateThresholdMinutes: true,
  lateHalfDayThresholdHours: true,
  halfDayMinimumHours: true,
  earlyGoingThresholdHours: true,
  earlyGoingFineAmount: true,
  halfDayDeductionPercent: true,
  absentFineAmount: true,
}

function num(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// The organization's attendance policy as plain numbers. An hours value of 0
// turns that rule off.
function attendancePolicy(org) {
  return {
    lateThresholdMinutes: num(org?.lateThresholdMinutes, DEFAULT_POLICY.lateThresholdMinutes),
    lateHalfDayThresholdHours: num(org?.lateHalfDayThresholdHours, DEFAULT_POLICY.lateHalfDayThresholdHours),
    halfDayMinimumHours: num(org?.halfDayMinimumHours, DEFAULT_POLICY.halfDayMinimumHours),
    earlyGoingThresholdHours: num(org?.earlyGoingThresholdHours, DEFAULT_POLICY.earlyGoingThresholdHours),
    earlyGoingFineAmount: num(org?.earlyGoingFineAmount, DEFAULT_POLICY.earlyGoingFineAmount),
    halfDayDeductionPercent: num(org?.halfDayDeductionPercent, DEFAULT_POLICY.halfDayDeductionPercent),
    // The day rate a half day is a percentage of (Attendance → Policy & fines).
    dayRate: num(org?.absentFineAmount, 0),
  }
}

function hhmm(minutes) {
  const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

function formatHours(hours) {
  return `${Number(hours)}h`
}

function formatClock(value, timeZone) {
  return new Date(value).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true })
}

// Shift window for one record's day, in the given timezone: the employee's
// own shift, else the organization default, else start + working hours. A
// shift ending at/before its start ends the next day (night shift).
function scheduleFor(employee, org, dateKey, timeZone) {
  const tz = getTimeZone(timeZone)
  const start = shiftStartMinutes(employee, org)
  const end =
    parseHHMM(String(employee?.shiftEnd || "").trim()) ??
    parseHHMM(org?.shiftEndDefault) ??
    (start + Math.round(num(org?.workingHoursPerDay, 8) * 60)) % MINUTES_PER_DAY
  const startAt = localDateTimeToUtc(`${dateKey} ${hhmm(start)}:00`, tz)
  let endAt = localDateTimeToUtc(`${dateKey} ${hhmm(end)}:00`, tz)
  if (end <= start) endAt = new Date(endAt.getTime() + DAY_MS)

  // The configured break, placed inside this shift.
  let breakWindow = null
  const bs = parseHHMM(org?.breakStart)
  const be = parseHHMM(org?.breakEnd)
  if (bs != null && be != null && bs !== be) {
    let breakStartAt = localDateTimeToUtc(`${dateKey} ${hhmm(bs)}:00`, tz)
    if (breakStartAt < startAt) breakStartAt = new Date(breakStartAt.getTime() + DAY_MS)
    const length = (be - bs + MINUTES_PER_DAY) % MINUTES_PER_DAY
    breakWindow = { startAt: breakStartAt, endAt: new Date(breakStartAt.getTime() + length * 60000) }
  }
  return {
    timeZone: tz,
    startAt,
    endAt,
    scheduledMinutes: Math.round((endAt - startAt) / 60000),
    breakWindow,
  }
}

const ATTENDED = new Set(["PRESENT", "LATE"])

// Pure evaluation of one day. `context`:
//   record   — { date, status, checkInAt, checkOutAt, workingMinutes, source, autoFlagged }
//   employee — { shiftStart, shiftEnd }
//   org      — ENGINE_ORG_SELECT fields
//   site     — { timezone } of the record's site, or null (org timezone used)
//   holiday, halfDayLeave — booleans for that date
//   now      — evaluation time (for "missing check-out")
// Returns the fields stored on AttendanceRecord plus display extras.
function evaluateAttendance({ record, employee, org, site = null, holiday = false, halfDayLeave = false, now = new Date() }) {
  const policy = attendancePolicy(org)
  const timeZone = getTimeZone(site?.timezone || org?.timezone || "UTC")
  const dateKey = toDateOnly(record.date).toISOString().slice(0, 10)
  const schedule = scheduleFor(employee, org, dateKey, timeZone)

  const empty = {
    scheduledStartAt: schedule.startAt,
    scheduledEndAt: schedule.endAt,
    lateMinutes: null,
    earlyGoingMinutes: null,
    dayType: null,
    dayTypeReason: null,
    deductionDays: null,
    earlyGoingFine: null,
    status: record.status,
    workedMinutes: null,
    missingCheckOut: false,
    timeZone,
  }

  const checkInAt = record.checkInAt ? new Date(record.checkInAt) : null
  if (!checkInAt || !ATTENDED.has(record.status)) return empty

  const lateMinutes = Math.max(0, Math.floor((checkInAt - schedule.startAt) / 60000))
  // Same late rule as before (shift start + grace), in the site's timezone.
  const arrivalStatus = lateMinutes > policy.lateThresholdMinutes ? "LATE" : "PRESENT"

  const checkOutAt = record.checkOutAt ? new Date(record.checkOutAt) : null
  // The break counts as office time: a check-out during the break is
  // treated as leaving at the end of the break, so stepping out for lunch
  // never turns a day into a half day on its own.
  let effectiveOut = checkOutAt
  const bw = schedule.breakWindow
  if (checkOutAt && bw && checkOutAt >= bw.startAt && checkOutAt < bw.endAt) effectiveOut = bw.endAt

  let workedMinutes = null
  if (checkOutAt) {
    workedMinutes =
      record.source === "BIOMETRIC" && record.workingMinutes != null
        ? Number(record.workingMinutes)
        : Math.max(0, Math.floor((effectiveOut - checkInAt) / 60000))
  }
  const earlyGoingMinutes = checkOutAt ? Math.max(0, Math.floor((schedule.endAt - effectiveOut) / 60000)) : null
  const missingCheckOut = !checkOutAt && now > schedule.endAt

  const result = {
    ...empty,
    lateMinutes,
    earlyGoingMinutes,
    workedMinutes,
    missingCheckOut,
    status: arrivalStatus,
  }

  // No half-day rules on holidays, non-workdays, or a day already covered by
  // approved half-day leave (arriving late / leaving early is expected then).
  if (holiday || !isScheduledWorkday(record.date, org) || halfDayLeave) {
    result.dayType = checkOutAt ? "FULL_DAY" : null
    result.dayTypeReason = halfDayLeave ? "Approved half-day leave" : null
    return result
  }

  const startLabel = formatClock(schedule.startAt, timeZone)
  const inLabel = formatClock(checkInAt, timeZone)
  const lateRule = policy.lateHalfDayThresholdHours > 0 && lateMinutes >= policy.lateHalfDayThresholdHours * 60
  const earlyRule = workedMinutes != null && policy.earlyGoingThresholdHours > 0 && workedMinutes <= policy.earlyGoingThresholdHours * 60
  const shortRule = workedMinutes != null && policy.halfDayMinimumHours > 0 && workedMinutes < policy.halfDayMinimumHours * 60
  const deductionDays = Math.round(policy.halfDayDeductionPercent) / 100

  if (earlyRule) {
    result.dayType = "EARLY_GOING"
    result.dayTypeReason = `Early going — worked ${formatDuration(workedMinutes)} (${formatHours(policy.earlyGoingThresholdHours)} or less)${
      earlyGoingMinutes ? `, left ${formatDuration(earlyGoingMinutes)} early` : ""
    }${lateRule ? `; also late arrival (${formatDuration(lateMinutes)})` : ""}`
    result.deductionDays = deductionDays
    result.earlyGoingFine = policy.earlyGoingFineAmount
  } else if (lateRule) {
    result.dayType = "HALF_DAY"
    result.dayTypeReason = `Late arrival — ${formatDuration(lateMinutes)} late (scheduled ${startLabel}, checked in ${inLabel})`
    result.deductionDays = deductionDays
  } else if (shortRule) {
    result.dayType = "HALF_DAY"
    result.dayTypeReason = `Worked ${formatDuration(workedMinutes)} — less than the ${formatHours(policy.halfDayMinimumHours)} needed for a full day`
    result.deductionDays = deductionDays
  } else if (checkOutAt) {
    result.dayType = "FULL_DAY"
  }
  return result
}

// Money value of a stored result, using the organization's current day rate.
function dayDeductionAmount(record, org) {
  const policy = attendancePolicy(org)
  const days = num(record?.deductionDays, 0)
  return Math.round((days * policy.dayRate + num(record?.earlyGoingFine, 0)) * 100) / 100
}

async function loadContext(db, record) {
  const [employee, org, site, holiday, halfDayLeave] = await Promise.all([
    db.user.findUnique({ where: { id: record.employeeId }, select: { shiftStart: true, shiftEnd: true } }),
    db.organization.findUnique({ where: { id: record.organizationId }, select: ENGINE_ORG_SELECT }),
    record.siteId ? db.attendanceSite.findUnique({ where: { id: record.siteId }, select: { timezone: true } }) : null,
    db.holiday.findFirst({ where: { organizationId: record.organizationId, date: record.date }, select: { id: true } }),
    db.leaveApplication.findFirst({
      where: { employeeId: record.employeeId, status: "APPROVED", isHalfDay: true, startDate: { lte: record.date }, endDate: { gte: record.date } },
      select: { id: true },
    }),
  ])
  return { employee, org, site, holiday: !!holiday, halfDayLeave: !!halfDayLeave }
}

// Re-evaluates one AttendanceRecord and stores the result. PRESENT/LATE is
// re-derived from the check-in time unless the record is autoFlagged (an
// outside-premises check-in whose status HR decides) — pass
// { recomputeStatus: true } to force it. Returns the updated record.
async function applyAttendanceEvaluation(db, recordId, { recomputeStatus } = {}) {
  const record = await db.attendanceRecord.findUnique({ where: { id: recordId } })
  if (!record) return null
  const context = await loadContext(db, record)
  const result = evaluateAttendance({ record, ...context })
  const statusChanges = (recomputeStatus ?? !record.autoFlagged) && ATTENDED.has(record.status) && record.checkInAt
  return db.attendanceRecord.update({
    where: { id: record.id },
    data: {
      scheduledStartAt: result.scheduledStartAt,
      scheduledEndAt: result.scheduledEndAt,
      lateMinutes: result.lateMinutes,
      earlyGoingMinutes: result.earlyGoingMinutes,
      dayType: result.dayType,
      dayTypeReason: result.dayTypeReason,
      deductionDays: result.deductionDays,
      earlyGoingFine: result.earlyGoingFine,
      evaluatedAt: new Date(),
      ...(statusChanges ? { status: result.status } : {}),
    },
  })
}

// Same, for an employee/day key (no-op when there's no record).
async function applyAttendanceEvaluationFor(db, employeeId, date) {
  const record = await db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: toDateOnly(date) } }, select: { id: true } })
  return record ? applyAttendanceEvaluation(db, record.id) : null
}

// After a record changed: keep that month's DRAFT payslip current. Required
// lazily — payroll.controller requires attendance code.
async function refreshPayslipForDay(organizationId, employeeId, date) {
  const { refreshDraftPayslip } = require("../controllers/payroll.controller")
  const day = toDateOnly(date)
  return refreshDraftPayslip({ organizationId, employeeId, month: day.getUTCMonth() + 1, year: day.getUTCFullYear() }).catch(() => null)
}

module.exports = {
  DEFAULT_POLICY,
  ENGINE_ORG_SELECT,
  attendancePolicy,
  scheduleFor,
  evaluateAttendance,
  dayDeductionAmount,
  applyAttendanceEvaluation,
  applyAttendanceEvaluationFor,
  refreshPayslipForDay,
}
