import { CreditCard, Users } from "lucide-react"
import { formatDate, formatMoney } from "../../utils/billing"

const STATUS_TONE = {
  ACTIVE: "bg-chip-green-bg text-chip-green-fg",
  PAST_DUE: "bg-chip-yellow-bg text-chip-yellow-fg",
  CANCELED: "bg-chip-pink-bg text-chip-pink-fg",
}

function Stat({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 text-sm font-semibold text-ink">{children}</div>
    </div>
  )
}

// "Current Subscription" — plan, status, next billing date, monthly cost.
export function CurrentSubscription({ subscription, onManageBilling, managing }) {
  const plan = subscription?.plan
  const paid = (subscription?.monthlyCostCents || 0) > 0
  const status = subscription?.status || "ACTIVE"
  return (
    <section className="card flex min-w-0 flex-col p-5 sm:p-6" aria-label="Current subscription">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <CreditCard size={14} /> Current Subscription
      </div>
      {!subscription ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-surface-2" />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-2xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>{plan?.name || "Free"}</p>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[status] || STATUS_TONE.ACTIVE}`}>
              {status === "PAST_DUE" ? "Past due" : status === "CANCELED" ? "Canceled" : "Active"}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Stat label="Monthly cost">{paid ? `${formatMoney(subscription.monthlyCostCents, plan?.currency)}/month` : "No upcoming charge"}</Stat>
            <Stat label="Next billing date">{paid ? formatDate(subscription.nextBillingDate) : "—"}</Stat>
          </div>
          <div className="mt-auto pt-5">
            <button type="button" onClick={onManageBilling} disabled={managing} className="pill-secondary w-full px-5 py-2.5 text-sm sm:w-auto">
              {managing ? "Opening…" : "Manage Billing"}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

// "Employee Usage" — seats used vs the plan's limit, with the limit-reached state.
export function EmployeeUsage({ usage, onUpgrade }) {
  const limit = usage?.limit
  const pct = limit ? Math.min(100, Math.round((usage.used / limit) * 100)) : 0
  const bar = usage?.limitReached ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-accent"
  return (
    <section className="card flex min-w-0 flex-col p-5 sm:p-6" aria-label="Employee usage">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <Users size={14} /> Employee Usage
      </div>
      {!usage ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-surface-2" />
      ) : (
        <>
          <p className="mt-3 text-2xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
            {usage.used}
            <span className="text-muted"> / {limit ?? "∞"}</span>
            <span className="ml-2 text-sm font-medium text-muted">employees</span>
          </p>
          {limit != null && (
            <div
              className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(usage.used, limit)}
              aria-label="Employees used"
            >
              <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
            </div>
          )}
          <p className={`mt-3 text-sm ${usage.limitReached ? "font-semibold text-danger" : "text-muted"}`}>
            {limit == null
              ? "No employee cap on your plan"
              : usage.limitReached
              ? usage.used > limit ? `Employee limit reached — ${usage.used - limit} over the ${usage.planName} limit` : "Employee limit reached"
              : `${usage.remaining} employee ${usage.remaining === 1 ? "slot" : "slots"} remaining`}
          </p>
          {usage.limitReached && (
            <div className="mt-auto pt-5">
              <button type="button" onClick={onUpgrade} className="pill-accent w-full px-5 py-2.5 text-sm sm:w-auto">Upgrade Plan</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
