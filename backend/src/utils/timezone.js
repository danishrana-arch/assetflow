function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format()
    return true
  } catch {
    return false
  }
}

function getTimeZone(timeZone) {
  return isValidTimeZone(timeZone) ? timeZone : "UTC"
}

function zonedParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value)
  const tz = getTimeZone(timeZone)
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const result = {}
  for (const part of parts) {
    if (part.type !== "literal") result[part.type] = Number(part.value)
  }
  return result
}

function dateKeyInTimeZone(value, timeZone) {
  const p = zonedParts(value, timeZone)
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

function localMinutes(value, timeZone) {
  const p = zonedParts(value, timeZone)
  return p.hour * 60 + p.minute
}

function isWithinTimeRange(minutes, start, end) {
  if (start == null || end == null) return false
  if (start === end) return false
  if (start < end) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

function parseHHMM(value) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))) return null
  const [hour, minute] = String(value).split(":").map(Number)
  return hour * 60 + minute
}

function isWithinBreak(value, timeZone, breakStart, breakEnd) {
  const start = parseHHMM(breakStart)
  const end = parseHHMM(breakEnd)
  if (start == null || end == null) return false
  return isWithinTimeRange(localMinutes(value, timeZone), start, end)
}

function localDateKeyToUtc(dateKey, timeZone) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return new Date(NaN)
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  let guess = target
  for (let i = 0; i < 4; i += 1) {
    const p = zonedParts(new Date(guess), timeZone)
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    guess += target - represented
  }
  return new Date(guess)
}

module.exports = {
  isValidTimeZone,
  getTimeZone,
  zonedParts,
  dateKeyInTimeZone,
  localMinutes,
  parseHHMM,
  isWithinTimeRange,
  isWithinBreak,
  localDateKeyToUtc,
}
