// Formatting helpers for the Billing page. Prices arrive from the API in cents.

export function formatMoney(cents, currency = "usd") {
  const amount = (cents || 0) / 100
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

// "YYYY-MM-DD" in the viewer's local time, for the date picker.
export function toDateInput(value) {
  if (!value) return ""
  const d = new Date(value)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function limitLabel(plan) {
  if (plan.employeeLimit != null) return `${plan.employeeLimit} employees`
  return plan.isCustom ? "Custom employee capacity" : "No employee cap"
}

// Whether moving from `current` to `target` is an upgrade (costs more).
export function isUpgrade(current, target) {
  return (target.effectivePriceCents || 0) > (current?.effectivePriceCents || 0)
}
