function workingMinutesPerDay(organization) {
  return Math.round(Number(organization?.workingHoursPerDay ?? 8) * 60)
}

function workingDaysPerWeek(organization) {
  return Number(organization?.workingDaysPerWeek ?? 5)
}

function expectedWeeklyMinutes(organization) {
  return workingMinutesPerDay(organization) * workingDaysPerWeek(organization)
}

function isScheduledWorkday(date, organization) {
  const day = new Date(date).getDay() // 0 Sunday ... 6 Saturday
  const configured = workingDaysPerWeek(organization)
  // The default 5-day office week is Monday-Friday. For other configured
  // counts, use the first N weekdays (e.g. 6 => Mon-Sat).
  return day >= 1 && day <= configured
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
  calculateWorkingMinutes,
}
