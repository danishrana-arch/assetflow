import { useEffect } from "react"
import { useLocation } from "react-router-dom"

// In-app page history for the back button: one entry per PAGE visited (by
// pathname). Search/filter changes on the same page (?date=, ?status=,
// ?tab=…) just update the current entry, so Back always returns to the
// previous *page* — with the filters it had — instead of stepping through
// every filter change. Kept in sessionStorage so a refresh doesn't lose it.

const KEY = "assetflow_page_history_v1"
const MAX = 50

function read() {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "[]")
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function write(stack) {
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX))) } catch { /* storage unavailable */ }
}

export function clearPageHistory() {
  try { sessionStorage.removeItem(KEY) } catch { /* storage unavailable */ }
}

// Called on every location change (DashboardLayout).
function record(pathname, search) {
  const stack = read()
  const top = stack[stack.length - 1]
  const entry = { pathname, search }
  if (top && top.pathname === pathname) {
    stack[stack.length - 1] = entry // same page, filters changed
  } else if (stack.length >= 2 && stack[stack.length - 2].pathname === pathname) {
    stack.pop() // went back (our button or the browser's)
    stack[stack.length - 1] = entry
  } else {
    stack.push(entry)
  }
  write(stack)
}

export function usePageHistoryTracker() {
  const { pathname, search } = useLocation()
  useEffect(() => { record(pathname, search) }, [pathname, search])
}

// Where Back should go: the previous page with its filters, or null.
export function previousPage() {
  const stack = read()
  const prev = stack[stack.length - 2]
  return prev ? prev.pathname + (prev.search || "") : null
}
