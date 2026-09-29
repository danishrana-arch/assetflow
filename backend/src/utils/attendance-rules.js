const { localMinutes, parseHHMM, getTimeZone } = require("./timezone")

const DEFAULT_SHIFT_START = "09:00"
const DEFAULT_LATE_THRESHOLD = 15

// The employee's own shift start wins over the organization default.
function shiftStartMinutes(employee, org) {
  return (
    parseHHMM(String(employee?.shiftStart || "").trim()) ??
    parseHHMM(org?.shiftStartDefault) ??
    parseHHMM(DEFAULT_SHIFT_START)
  )
}

// Single late rule for every attendance source (app check-in, offline sync,
// biometric, admin marking): late when the check-in's local minute is past
// shift start + threshold. Shift 10:00 with a 15 min threshold → 10:15 is on
// time, 10:16 is LATE.
function isLateCheckIn(checkInAt, employee, org) {
  if (!checkInAt) return false
  const threshold = Number(org?.lateThresholdMinutes ?? DEFAULT_LATE_THRESHOLD)
  return localMinutes(checkInAt, org?.timezone || "UTC") > shiftStartMinutes(employee, org) + threshold
}

// PRESENT/LATE resolved from the check-in time; other statuses unchanged.
function resolveArrivalStatus(status, checkInAt, employee, org) {
  if (status !== "PRESENT" && status !== "LATE") return status
  if (!checkInAt) return status
  return isLateCheckIn(checkInAt, employee, org) ? "LATE" : "PRESENT"
}

// 12-hour times for exported sheets, in the organization's timezone.
function formatTime12(value, timeZone) {
  if (!value) return ""
  return new Date(value).toLocaleTimeString("en-US", {
    timeZone: getTimeZone(timeZone),
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  })
}

function formatDateTime12(value, timeZone) {
  if (!value) return ""
  const date = new Date(value)
  const tz = getTimeZone(timeZone)
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(date)
  const time = date.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true })
  return `${day} ${time}`
}

module.exports = {
  shiftStartMinutes,
  isLateCheckIn,
  resolveArrivalStatus,
  formatTime12,
  formatDateTime12,
}
