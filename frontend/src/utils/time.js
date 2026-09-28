// Shared 12-hour (AM/PM) time formatting. `hour12: true` is passed
// explicitly everywhere because the browser default follows the OS locale,
// which renders a 24-hour clock on many machines (e.g. en-GB, most of Europe).

export function formatTime(value, { timeZone, seconds = false } = {}) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString("en-US", {
    timeZone: timeZone || undefined,
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: true,
  })
}

export function formatDateTime(value, options = {}) {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
    hour12: true,
  })
}

// "18:30" (the value an <input type="time"> / stored shift field holds) -> "6:30 PM".
export function formatClock(hhmm) {
  if (!hhmm) return ""
  const [h, m] = String(hhmm).split(":").map(Number)
  if (Number.isNaN(h)) return hhmm
  const period = h >= 12 ? "PM" : "AM"
  const hour = h % 12 || 12
  return `${hour}:${String(m || 0).padStart(2, "0")} ${period}`
}
