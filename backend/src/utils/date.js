function toDateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  }
  const str = String(value)
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) {
    const [, y, m, d] = match
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }
  // Fallback for anything that isn't already "YYYY-MM-DD"-prefixed.
  const parsed = new Date(str)
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

// Add `days` to a UTC-midnight Date without local-timezone mutation.
function addDaysUTC(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

module.exports = { toDateOnly, dateKey, addDaysUTC }
