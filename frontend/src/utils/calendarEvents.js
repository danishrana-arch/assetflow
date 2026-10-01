// Calendar events come one per day (so calendar grids can mark each day a
// person is off). Lists should show a multi-day leave once, as a range.

// Collapses EMPLOYEE_LEAVE events that belong to the same leave into the
// first one in the list; that event gets `rangeStart`/`rangeEnd` set to the
// leave's full dates. Everything else passes through unchanged, in order.
export function groupLeaveEvents(events = []) {
  const seen = new Set()
  const out = []
  for (const e of events) {
    if (e.type === "EMPLOYEE_LEAVE" && e.leaveId) {
      if (seen.has(e.leaveId)) continue
      seen.add(e.leaveId)
      out.push(e.leaveStart && e.leaveEnd && e.leaveStart !== e.leaveEnd ? { ...e, rangeStart: e.leaveStart, rangeEnd: e.leaveEnd } : e)
    } else {
      out.push(e)
    }
  }
  return out
}

const day = (key, options) => new Date(`${key}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...options })

// "Wed, Oct 14" for one day, "Thu, Oct 15 – Mon, Oct 19 (5 days)" for a
// grouped leave. `options` are toLocaleDateString options.
export function eventDateLabel(event, options = { weekday: "short", month: "short", day: "numeric" }) {
  if (event.rangeStart && event.rangeEnd) {
    const days = Math.round((new Date(`${event.rangeEnd}T00:00:00Z`) - new Date(`${event.rangeStart}T00:00:00Z`)) / 86400000) + 1
    return `${day(event.rangeStart, options)} – ${day(event.rangeEnd, options)} (${days} days)`
  }
  return day(event.date, options)
}
