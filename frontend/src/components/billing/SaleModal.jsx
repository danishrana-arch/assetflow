import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import Modal from "./Modal"
import { TextField } from "../ui/Field"
import { billingApi, errorText } from "../../api/billing"
import { formatMoney, toDateInput } from "../../utils/billing"

// Put a plan on sale (percent off, optional label and start/end dates) or end a running sale.
export default function SaleModal({ plan, onClose, onSaved, api = billingApi }) {
  const [percent, setPercent] = useState(plan.sale ? String(plan.sale.percent) : "20")
  const [label, setLabel] = useState(plan.sale?.label || "")
  const [startsAt, setStartsAt] = useState(toDateInput(plan.sale?.startsAt))
  const [endsAt, setEndsAt] = useState(toDateInput(plan.sale?.endsAt))
  const [error, setError] = useState("")

  const pct = Number(percent)
  const valid = Number.isInteger(pct) && pct >= 1 && pct <= 99
  const preview = valid ? Math.round(plan.priceCents * (100 - pct) / 100) : null

  const save = useMutation({
    mutationFn: () =>
      api.setSale(plan.id, {
        percent: pct,
        label,
        // Dates are whole days in the viewer's timezone.
        startsAt: startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : null,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      }),
    onSuccess: onSaved,
    onError: (err) => setError(errorText(err)),
  })
  const end = useMutation({
    mutationFn: () => api.endSale(plan.id),
    onSuccess: onSaved,
    onError: (err) => setError(errorText(err)),
  })
  const busy = save.isPending || end.isPending

  return (
    <Modal
      title={`Sale — ${plan.name}`}
      subtitle="Subscribers who join during a sale keep the sale price."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          {plan.sale && (
            <button type="button" onClick={() => end.mutate()} disabled={busy} className="rounded-full px-5 py-2.5 text-sm font-semibold text-danger hover:bg-surface-2 sm:mr-auto">
              {end.isPending ? "Ending…" : "End sale"}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button type="button" onClick={() => { setError(""); save.mutate() }} disabled={busy || !valid} className="pill-accent px-5 py-2.5 text-sm">
            {save.isPending ? "Saving…" : plan.sale ? "Update sale" : "Start sale"}
          </button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Discount (%)" type="number" min="1" max="99" step="1" value={percent} onChange={(e) => setPercent(e.target.value)} />
          <TextField label="Badge text" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Launch offer" hint="Optional — defaults to “Sale”." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} hint="Empty = starts now." />
          <TextField label="Ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} hint="Empty = until you end it." />
        </div>
        <div className="rounded-2xl bg-surface-2 p-4 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Customers will see</p>
          <p className="mt-1 text-ink">
            {preview != null ? (
              <>
                <span className="text-lg font-semibold">{formatMoney(preview, plan.currency)}</span>
                <span className="text-muted"> / month </span>
                <span className="text-muted line-through">{formatMoney(plan.priceCents, plan.currency)}</span>
              </>
            ) : (
              <span className="text-muted">Enter a discount from 1 to 99.</span>
            )}
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
