// Case-insensitive, natural ordering for list pages. Postgres' default
// collation sorts "Zain" before "abc", which looks broken in a directory, so
// list endpoints sort in JS instead. Empty values always go last; ties fall
// back to `tieBreak` (usually the row's name).
function compareValues(a, b) {
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b), "en", { sensitivity: "base", numeric: true })
  }
  return a - b
}

function sortRows(rows, getValue, order = "asc", tieBreak) {
  const dir = order === "desc" ? -1 : 1
  return [...rows].sort((x, y) => {
    const a = getValue(x), b = getValue(y)
    const aEmpty = a == null || a === "", bEmpty = b == null || b === ""
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1
    const primary = aEmpty ? 0 : compareValues(a, b) * dir
    if (primary || !tieBreak) return primary
    return compareValues(tieBreak(x) ?? "", tieBreak(y) ?? "")
  })
}

module.exports = { sortRows }
