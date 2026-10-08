// Small helpers shared by the Control Center screens.

export const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—")
export const fmtDateTime = (v) =>
  v ? new Date(v).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—"

// StatusPill tone for the status words used across the console.
const TONES = {
  ACTIVE: "green", ENABLED: "green", PAID: "green", ok: "green",
  ARCHIVED: "slate", DISABLED: "slate", CLOSED: "slate", LEFT_COMPANY: "slate",
  PAST_DUE: "yellow", warn: "yellow", PROBATION: "yellow", OPEN: "yellow", ON_LEAVE: "yellow",
  NEW: "blue", CONTACTED: "blue",
  CANCELED: "pink", SUSPENDED: "pink", over: "pink", full: "pink", error: "pink",
}
export const toneFor = (status) => TONES[status] || "slate"

export const label = (s) => String(s || "").replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
export const actionLabel = (a) => String(a || "").replaceAll(".", " · ").replaceAll("_", " ")

export const errorMessage = (err, fallback = "Something went wrong — please try again") => err?.response?.data?.error || fallback
