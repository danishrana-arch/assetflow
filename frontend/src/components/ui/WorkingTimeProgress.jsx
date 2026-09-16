function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "—"
  const value = Math.max(0, Math.round(Number(minutes) || 0))
  const hours = Math.floor(value / 60)
  const mins = value % 60
  return `${hours}h ${mins.toString().padStart(2, "0")}m`
}

function endOfDayUTC(dateValue) {
  const d = new Date(dateValue)
  if (Number.isNaN(d.getTime())) return null
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999))
}

// Falls back to a live checkIn→checkOut (or checkIn→now, if still checked
// in) span whenever the record has no explicit workingMinutes — that field
// is only ever populated by the biometric-device sync path, so self-service
// check-in/out would otherwise always show a blank progress bar.
//
// When there's no checkOutAt yet, the running total is capped at the end of
// that record's calendar day rather than the raw current time — so a shift
// nobody checked out of stops climbing at midnight instead of quietly
// accumulating hours into the next day every time the page is viewed.
export function effectiveWorkingMinutes({ workingMinutes, checkInAt, checkOutAt, date }) {
  if (workingMinutes !== null && workingMinutes !== undefined) return Number(workingMinutes)
  if (!checkInAt) return null
  let end = checkOutAt ? new Date(checkOutAt) : new Date()
  if (!checkOutAt) {
    const dayEnd = date ? endOfDayUTC(date) : null
    if (dayEnd && end > dayEnd) end = dayEnd
  }
  return Math.max(0, Math.round((end - new Date(checkInAt)) / 60000))
}

// Fill color always follows the organization's brand color via the
// `accent` Tailwind token (`var(--accent)`), so it stays in sync with
// whatever an admin/CEO picks on the Settings page — no separate wiring
// needed here.
export default function WorkingTimeProgress({ workingMinutes, checkInAt, checkOutAt, expectedMinutes, date, className = "" }) {
  const worked = effectiveWorkingMinutes({ workingMinutes, checkInAt, checkOutAt, date })
  if (worked === null) {
    return <p className={`text-xs text-muted-2 ${className}`}>—</p>
  }
  const expected = Math.max(1, Math.round(Number(expectedMinutes) || 480))
  const percent = Math.min(100, Math.round((worked / expected) * 100))
  const overMinutes = Math.max(0, worked - expected)

  return (
    <div className={`min-w-[120px] max-w-[180px] ${className}`}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[10px] font-medium text-muted">
        {formatMinutes(worked)} <span className="text-muted-2">/ {formatMinutes(expected)}</span>
        {overMinutes > 0 && <span className="text-muted-2"> (+{formatMinutes(overMinutes)})</span>}
      </p>
    </div>
  )
}
