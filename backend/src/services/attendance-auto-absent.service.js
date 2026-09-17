const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")
const { isScheduledWorkday } = require("../utils/work-schedule")
const { dateKeyInTimeZone, localMinutes, parseHHMM } = require("../utils/timezone")

const CHECK_INTERVAL_MS = 15 * 60 * 1000

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

// An employee who never checks in has no natural end-of-day event to
// trigger an ABSENT status, so once the working day is half over without a
// check-in, this marks it ABSENT automatically — reusing `autoFlagged`
// (rather than a new source/status value) since it already means exactly
// "the system decided this, not a human", and an admin overriding the
// status already clears it the same way it does for a geofence override.
async function markUncheckedInEmployeesAbsent() {
  if (running) return
  running = true
  try {
    const organizations = await prisma.organization.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        timezone: true,
        shiftStartDefault: true,
        shiftEndDefault: true,
        workingHoursPerDay: true,
        workingDaysPerWeek: true,
      },
    })

    const now = new Date()
    for (const organization of organizations) {
      try {
        const timezone = organization.timezone || "Asia/Karachi"
        const today = toDateOnly(dateKeyInTimeZone(now, timezone))
        if (!isScheduledWorkday(today, organization)) continue

        const { start, halfway } = halfDayCutoffMinutes(organization)
        if (!isPastHalfDay(localMinutes(now, timezone), start, halfway)) continue

        const employees = await prisma.user.findMany({
          where: { organizationId: organization.id, status: "ACTIVE" },
          select: { id: true },
        })
        if (!employees.length) continue

        const existing = await prisma.attendanceRecord.findMany({
          where: { organizationId: organization.id, date: today, employeeId: { in: employees.map((e) => e.id) } },
          select: { employeeId: true },
        })
        const alreadyRecorded = new Set(existing.map((r) => r.employeeId))
        const toMark = employees.filter((e) => !alreadyRecorded.has(e.id))
        if (!toMark.length) continue

        await prisma.attendanceRecord.createMany({
          data: toMark.map((e) => ({
            organizationId: organization.id,
            employeeId: e.id,
            date: today,
            status: "ABSENT",
            autoFlagged: true,
          })),
          skipDuplicates: true,
        })
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
