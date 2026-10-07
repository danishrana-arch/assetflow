const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")
const { isScheduledWorkday } = require("../utils/work-schedule")
const { dateKeyInTimeZone, localMinutes, parseHHMM } = require("../utils/timezone")

const CHECK_INTERVAL_MS = 15 * 60 * 1000
const DAY_MS = 86400000
// Past days re-checked on every run, so a day the backend was down for
// (no run after its half-day cutoff) still gets filled in afterward.
const LOOKBACK_DAYS = 7

let running = false

// Half of the organization's scheduled shift window (shiftStartDefault to
// shiftEndDefault, or shiftStartDefault + workingHoursPerDay when no end
// time is configured). Wraps correctly for an overnight shift.
function halfDayCutoffMinutes(organization) {
  const start = parseHHMM(organization.shiftStartDefault) ?? 9 * 60
  const configuredEnd = parseHHMM(organization.shiftEndDefault)
  const end = configuredEnd ?? (start + Math.round(Number(organization.workingHoursPerDay || 8) * 60)) % (24 * 60)
  const span = end > start ? end - start : 24 * 60 - start + end
  return { start, halfway: (start + Math.floor(span / 2)) % (24 * 60) }
}

function isPastHalfDay(nowMinutes, start, halfway) {
  // Same wraparound rule used elsewhere for overnight ranges: if the
  // cutoff is "before" the start in raw minutes, it actually falls after
  // midnight, so "past cutoff" also covers the early-morning wrap.
  return halfway >= start ? nowMinutes >= halfway : nowMinutes >= halfway && nowMinutes < start
}

// An employee who never checks in (or isn't marked by an admin / the
// biometric device) has no natural end-of-day event to trigger an ABSENT
// status, so this marks a scheduled workday ABSENT once it's half over —
// today after the half-day cutoff, plus any of the last LOOKBACK_DAYS that
// were missed. Reuses `autoFlagged` ("the system decided this, not a
// human"). A later check-in the same day still overwrites it with
// PRESENT/LATE, and an admin can override it from the Attendance page.
//
// Never marked: non-workdays, company holidays, days before the employee
// joined (joiningDate, else account creation), and — for today only —
// employees on an approved half-day leave (they may come in for the other
// half). An approved full-day leave is recorded as LEAVE, not ABSENT.
async function markDayForOrganization(organization, day, { isToday }) {
  if (!isScheduledWorkday(day, organization)) return 0

  const holiday = await prisma.holiday.findFirst({ where: { organizationId: organization.id, date: day }, select: { id: true } })
  if (holiday) return 0

  const employees = await prisma.user.findMany({
    where: { organizationId: organization.id, status: "ACTIVE" },
    select: { id: true, joiningDate: true, createdAt: true },
  })
  const eligible = employees.filter((e) => {
    const started = toDateOnly(e.joiningDate || e.createdAt)
    return started.getTime() <= day.getTime()
  })
  if (!eligible.length) return 0

  const existing = await prisma.attendanceRecord.findMany({
    where: { organizationId: organization.id, date: day, employeeId: { in: eligible.map((e) => e.id) } },
    select: { employeeId: true },
  })
  const alreadyRecorded = new Set(existing.map((r) => r.employeeId))
  const unrecorded = eligible.filter((e) => !alreadyRecorded.has(e.id))
  if (!unrecorded.length) return 0

  const leaves = await prisma.leaveApplication.findMany({
    where: {
      employeeId: { in: unrecorded.map((e) => e.id) },
      status: "APPROVED",
      startDate: { lte: day },
      endDate: { gte: day },
    },
    select: { employeeId: true, isHalfDay: true },
  })
  const fullLeave = new Set(leaves.filter((l) => !l.isHalfDay).map((l) => l.employeeId))
  const halfLeave = new Set(leaves.filter((l) => l.isHalfDay).map((l) => l.employeeId))

  const data = []
  for (const e of unrecorded) {
    if (fullLeave.has(e.id)) {
      data.push({ organizationId: organization.id, employeeId: e.id, date: day, status: "LEAVE" })
    } else if (isToday && halfLeave.has(e.id)) {
      continue
    } else {
      data.push({ organizationId: organization.id, employeeId: e.id, date: day, status: "ABSENT", autoFlagged: true })
    }
  }
  if (!data.length) return 0

  const result = await prisma.attendanceRecord.createMany({ data, skipDuplicates: true })
  return result.count
}

async function markUncheckedInEmployeesAbsent() {
  if (running) return
  running = true
  try {
    const organizations = await prisma.organization.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        createdAt: true,
        timezone: true,
        shiftStartDefault: true,
        shiftEndDefault: true,
        workingHoursPerDay: true,
        workingDaysPerWeek: true, workingDays: true,
      },
    })

    const now = new Date()
    for (const organization of organizations) {
      try {
        const timezone = organization.timezone || "Asia/Karachi"
        const today = toDateOnly(dateKeyInTimeZone(now, timezone))
        const orgStart = toDateOnly(organization.createdAt)

        // Past days first (fully over), oldest to newest.
        for (let i = LOOKBACK_DAYS; i >= 1; i -= 1) {
          const day = new Date(today.getTime() - i * DAY_MS)
          if (day.getTime() < orgStart.getTime()) continue
          await markDayForOrganization(organization, day, { isToday: false })
        }

        const { start, halfway } = halfDayCutoffMinutes(organization)
        if (isPastHalfDay(localMinutes(now, timezone), start, halfway)) {
          await markDayForOrganization(organization, today, { isToday: true })
        }
      } catch (orgError) {
        console.error(`Attendance auto-absent job failed for organization ${organization.id}:`, orgError.message)
      }
    }
  } catch (error) {
    console.error("Attendance auto-absent job failed:", error.message)
  } finally {
    running = false
  }
}

function startAttendanceAutoAbsentJob() {
  setTimeout(markUncheckedInEmployeesAbsent, 15_000)
  setInterval(markUncheckedInEmployeesAbsent, CHECK_INTERVAL_MS)
}

module.exports = { startAttendanceAutoAbsentJob, markUncheckedInEmployeesAbsent }
