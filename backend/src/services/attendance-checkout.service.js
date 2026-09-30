const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")
const { createNotification } = require("../utils/notifications")
const { formatTime12, shiftStartMinutes } = require("../utils/attendance-rules")
const { dateKeyInTimeZone, localDateKeyToUtc, localDateTimeToUtc, parseHHMM } = require("../utils/timezone")

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const DAY_MS = 86400000
// Open shifts this many days back are still closed out (covers downtime).
const LOOKBACK_DAYS = 3
// An overnight shift (ending after midnight) is auto-closed this long after
// its end instead of at midnight.
const OVERNIGHT_GRACE_MS = 4 * 60 * 60 * 1000
const NOTE_MAX_LENGTH = 500

let running = false

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

// The instant this record's shift ends: the employee's own shiftEnd, else
// the organization's shiftEndDefault, else shift start + workingHoursPerDay.
// A shift ending at/before its start time ends on the next calendar day.
function shiftEndInstant(record, employee, organization, timezone) {
  const start = shiftStartMinutes(employee, organization)
  const end =
    parseHHMM(employee.shiftEnd) ??
    parseHHMM(organization.shiftEndDefault) ??
    (start + Math.round(Number(organization.workingHoursPerDay || 8) * 60)) % (24 * 60)
  const dateKey = record.date.toISOString().slice(0, 10)
  const instant = localDateTimeToUtc(`${dateKey} ${hhmm(end)}:00`, timezone)
  return end <= start ? new Date(instant.getTime() + DAY_MS) : instant
}

// The shift is "missed" once the record's own day is over (local midnight),
// or, for an overnight shift, OVERNIGHT_GRACE_MS after it ended.
function autoCheckoutAt(record, shiftEnd, timezone) {
  const nextDay = new Date(record.date.getTime() + DAY_MS).toISOString().slice(0, 10)
  const midnight = localDateKeyToUtc(nextDay, timezone)
  return shiftEnd.getTime() < midnight.getTime() ? midnight : new Date(shiftEnd.getTime() + OVERNIGHT_GRACE_MS)
}

async function appendSystemNote(organizationId, employeeId, date, text) {
  const existing = await prisma.attendanceNote.findUnique({ where: { employeeId_date: { employeeId, date } } })
  if (existing?.note.includes(text)) return
  const note = (existing ? `${existing.note}\n${text}` : text).slice(0, NOTE_MAX_LENGTH)
  await prisma.attendanceNote.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { note },
    create: { organizationId, employeeId, date, note },
  })
}

// For every open shift (checked in, not checked out):
//  1. once the shift's end time passes, the employee gets one in-app
//     "time to check out" reminder;
//  2. if they still haven't checked out when that day is over, the system
//     records the check-out at the shift end time (never earlier than the
//     check-in), flags it `autoCheckedOut`, adds a day note for HR and tells
//     the employee.
// A check-out the employee makes themselves before step 2 always wins.
async function processOrganization(organization, now) {
  const timezone = organization.timezone || "Asia/Karachi"
  const today = toDateOnly(dateKeyInTimeZone(now, timezone))
  const since = new Date(today.getTime() - LOOKBACK_DAYS * DAY_MS)

  const open = await prisma.attendanceRecord.findMany({
    where: { organizationId: organization.id, date: { gte: since, lte: today }, checkInAt: { not: null }, checkOutAt: null },
    select: {
      id: true, employeeId: true, date: true, checkInAt: true, checkoutReminderSentAt: true,
      employee: { select: { shiftStart: true, shiftEnd: true } },
    },
  })

  for (const record of open) {
    const shiftEnd = shiftEndInstant(record, record.employee, organization, timezone)
    if (now < shiftEnd) continue
    const endLabel = formatTime12(shiftEnd, timezone)
    const autoAt = autoCheckoutAt(record, shiftEnd, timezone)

    if (now >= autoAt) {
      const checkOutAt = record.checkInAt > shiftEnd ? record.checkInAt : shiftEnd
      const { count } = await prisma.attendanceRecord.updateMany({
        where: { id: record.id, checkOutAt: null },
        data: { checkOutAt, autoCheckedOut: true },
      })
      if (!count) continue
      const outLabel = formatTime12(checkOutAt, timezone)
      await appendSystemNote(organization.id, record.employeeId, record.date, `Didn't check out — checked out automatically at shift end (${outLabel}).`)
      await createNotification({
        organizationId: organization.id,
        recipientId: record.employeeId,
        type: "ATTENDANCE",
        title: "Checked out automatically",
        message: `You didn't check out on ${record.date.toISOString().slice(0, 10)}, so your check-out was recorded at your shift end (${outLabel}). If you worked extra hours, add them in your attendance note.`,
        link: "/attendance/me",
      })
      continue
    }

    if (!record.checkoutReminderSentAt) {
      const { count } = await prisma.attendanceRecord.updateMany({
        where: { id: record.id, checkoutReminderSentAt: null, checkOutAt: null },
        data: { checkoutReminderSentAt: now },
      })
      if (!count) continue
      await createNotification({
        organizationId: organization.id,
        recipientId: record.employeeId,
        type: "ATTENDANCE",
        title: "Time to check out",
        message: `Your shift ended at ${endLabel}. Please check out now. If you don't check out today, your check-out will be recorded automatically at ${endLabel}.`,
        link: "/attendance/me",
      })
    }
  }
}

async function processCheckouts() {
  if (running) return
  running = true
  try {
    const organizations = await prisma.organization.findMany({
      where: { archivedAt: null },
      select: { id: true, timezone: true, shiftStartDefault: true, shiftEndDefault: true, workingHoursPerDay: true },
    })
    const now = new Date()
    for (const organization of organizations) {
      try {
        await processOrganization(organization, now)
      } catch (orgError) {
        console.error(`Attendance checkout job failed for organization ${organization.id}:`, orgError.message)
      }
    }
  } catch (error) {
    console.error("Attendance checkout job failed:", error.message)
  } finally {
    running = false
  }
}

function startAttendanceCheckoutJob() {
  setTimeout(processCheckouts, 20_000)
  setInterval(processCheckouts, CHECK_INTERVAL_MS)
}

module.exports = { startAttendanceCheckoutJob, processCheckouts, processOrganization, shiftEndInstant, autoCheckoutAt }
