import { Check, Pencil, Tag, Trash2 } from "lucide-react"
import { formatDate, formatMoney, isUpgrade, limitLabel } from "../../utils/billing"

// One pricing card. `state` drives the button:
// current | upgrade | downgrade | free | contact | processing | payment-required
function buttonFor(plan, current, { processing, paymentRequired }) {
  if (current && current.id === plan.id) return { label: "Current Plan", disabled: true, style: "bg-surface-2 text-muted" }
  if (plan.isCustom) return { label: "Contact Our Team", style: "pill-secondary" }
  if (processing) return { label: "Processing…", disabled: true, style: "pill-primary opacity-70" }
  if (paymentRequired) return { label: "Payment Required", disabled: true, style: "bg-chip-yellow-bg text-chip-yellow-fg" }
  if (plan.effectivePriceCents === 0) return { label: `Choose ${plan.name}`, style: "pill-secondary" }
  if (isUpgrade(current, plan)) return { label: `Upgrade to ${plan.name}`, style: plan.recommended ? "pill-accent" : "pill-primary" }
  return { label: `Downgrade to ${plan.name}`, style: "pill-secondary" }
}

export default function PlanCard({ plan, current, processing, paymentRequired, canManage, onSelect, onEdit, onSale, onDelete }) {
  const btn = buttonFor(plan, current, { processing, paymentRequired })
  const sale = plan.sale?.active ? plan.sale : null
  const paid = plan.priceCents > 0 && !plan.isCustom
  const isCurrent = current && current.id === plan.id

  return (
    <article
      className={`card relative flex min-w-0 flex-col p-6 transition-shadow duration-200 hover:shadow-lg ${
        plan.recommended ? "ring-2 ring-accent xl:-translate-y-1" : ""
      } ${plan.active ? "" : "opacity-60"}`}
      aria-label={`${plan.name} plan`}
    >
      <div className="flex min-h-[24px] flex-wrap items-center gap-2">
        {plan.recommended && (
          <span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-on-accent">Recommended</span>
        )}
        {sale && (
          <span className="rounded-full bg-chip-pink-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-chip-pink-fg">
            {sale.label || "Sale"} · {sale.percent}% off
          </span>
        )}
        {!plan.active && <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Inactive</span>}
        {plan.sale && !plan.sale.active && canManage && (
          <span className="rounded-full bg-chip-yellow-bg px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-chip-yellow-fg">
            Sale {plan.sale.status === "SCHEDULED" ? `starts ${formatDate(plan.sale.startsAt)}` : "ended"}
          </span>
        )}
      </div>

      <h3 className="mt-3 text-lg font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>{plan.name}</h3>
      <p className="mt-1 min-h-[40px] text-xs leading-5 text-muted">{plan.description}</p>

      <div className="mt-4">
        {plan.isCustom ? (
          <p className="text-3xl font-semibold text-ink" style={{ letterSpacing: "-0.03em" }}>Custom</p>
        ) : (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className="text-3xl font-semibold text-ink" style={{ letterSpacing: "-0.03em" }}>{formatMoney(plan.effectivePriceCents, plan.currency)}</span>
              <span className="text-xs text-muted">/ month</span>
            </p>
            <p className="mt-1 h-4 text-xs text-muted">
              {sale && (
                <>
                  <span className="line-through">{formatMoney(plan.priceCents, plan.currency)}</span>
                  {sale.endsAt && <span> · ends {formatDate(sale.endsAt)}</span>}
                </>
              )}
            </p>
          </>
        )}
        <p className="mt-2 inline-block rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-ink">{limitLabel(plan)}</p>
      </div>

      <ul className="mt-5 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-xs text-muted">
            <Check size={14} strokeWidth={2.5} className="mt-px shrink-0 text-ink" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={btn.disabled}
        onClick={() => onSelect(plan)}
        className={`mt-6 w-full rounded-full py-2.5 text-sm font-semibold transition-opacity ${btn.style}`}
      >
        {btn.label}
      </button>

      {canManage && (
        <div className="mt-3 flex items-center justify-center gap-1 border-t border-border pt-3">
          <button type="button" onClick={() => onEdit(plan)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink">
            <Pencil size={13} /> Edit
          </button>
          {paid && (
            <button type="button" onClick={() => onSale(plan)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink">
              <Tag size={13} /> Sale
            </button>
          )}
          <button type="button" onClick={() => onDelete(plan)} disabled={isCurrent} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-surface-2 disabled:opacity-40">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </article>
  )
}
