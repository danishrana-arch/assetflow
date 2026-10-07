function workingMinutesPerDay(organization) {
  return Math.round(Number(organization?.workingHoursPerDay ?? 8) * 60)
}

function workingDaysPerWeek(organization) {
  return Number(organization?.workingDaysPerWeek ?? 5)
}

function expectedWeeklyMinutes(organization) {
  return workingMinutesPerDay(organization) * workingDaysPerWeek(organization)
}

// The organization's working weekdays (0 Sunday … 6 Saturday), from
// Organization.workingDays ("1,2,3,4,5"); an org object without it (older
// select) falls back to the first workingDaysPerWeek days from Monday.
function workingDaySet(organization) {
  const raw = organization?.workingDays
  if (typeof raw === "string" && raw.trim()) {
    const set = new Set(raw.split(",").map((v) => Number(v.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))
    if (set.size) return set
  }
  const n = workingDaysPerWeek(organization)
  return new Set(n >= 7 ? [0, 1, 2, 3, 4, 5, 6] : Array.from({ length: Math.max(1, n) }, (_, i) => i + 1))
}

// Parses a workingDays value from the API (array or "1,2,3") into the
// stored string, or null if it isn't a valid non-empty set of weekdays.
function normalizeWorkingDays(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",")
  const days = [...new Set(list.map((v) => Number(String(v).trim())))]
  if (!days.length || days.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) return null
  return days.sort((a, b) => a - b).join(",")
}

function isScheduledWorkday(date, organization) {
  // Dates here are date-only values stored as UTC midnight, so read the
  // UTC weekday — local getDay() would shift a day on a server west of UTC.
  return workingDaySet(organization).has(new Date(date).getUTCDay())
}

function calculateWorkingMinutes(checkInAt, checkOutAt, organization) {
  if (!checkInAt || !checkOutAt) return null
  const inTime = new Date(checkInAt).getTime()
  const outTime = new Date(checkOutAt).getTime()
  if (!Number.isFinite(inTime) || !Number.isFinite(outTime) || outTime <= inTime) return 0
  return Math.max(0, Math.round((outTime - inTime) / 60000))
}

module.exports = {
  workingMinutesPerDay,
  workingDaysPerWeek,
  expectedWeeklyMinutes,
  isScheduledWorkday,
  workingDaySet,
  normalizeWorkingDays,
  calculateWorkingMinutes,
}
