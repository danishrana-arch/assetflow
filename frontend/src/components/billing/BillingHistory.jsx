import { Download, ExternalLink, Receipt } from "lucide-react"
import { formatDate, formatMoney } from "../../utils/billing"

const TONE = {
  PAID: "bg-chip-green-bg text-chip-green-fg",
  OPEN: "bg-chip-yellow-bg text-chip-yellow-fg",
  VOID: "bg-surface-2 text-muted",
}

function LinkButton({ href, icon: Icon, children }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-ink">
      <Icon size={13} /> {children}
    </a>
  )
}

export default function BillingHistory({ invoices, loading }) {
  return (
    <section className="card p-5 sm:p-6" aria-label="Billing history">
      <h2 className="text-base font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>Billing History</h2>
      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-2xl bg-surface-2" />
      ) : !invoices?.length ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl bg-surface-2 px-4 py-10 text-center">
          <Receipt size={28} className="text-muted" />
          <p className="text-sm font-semibold text-ink">No billing history yet</p>
          <p className="max-w-sm text-xs text-muted">Invoices appear here once you subscribe to a paid plan.</p>
        </div>
      ) : (
        <>
          {/* Phones: stacked cards */}
          <ul className="mt-4 space-y-3 md:hidden">
            {invoices.map((inv) => (
              <li key={inv.id} className="rounded-2xl bg-surface-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">{inv.number}</p>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[inv.status] || TONE.OPEN}`}>{inv.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{formatDate(inv.issuedAt)} · {formatMoney(inv.amountCents, inv.currency)}</p>
                <div className="mt-2 flex gap-1"><LinkButton href={inv.hostedUrl} icon={ExternalLink}>View</LinkButton><LinkButton href={inv.pdfUrl} icon={Download}>Download</LinkButton></div>
              </li>
            ))}
          </ul>
          {/* Tablet and up: table */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Invoice</th>
                  <th className="pb-3 pr-4">Amount</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="py-3 pr-4 text-ink">{formatDate(inv.issuedAt)}</td>
                    <td className="py-3 pr-4 font-semibold text-ink">{inv.number}</td>
                    <td className="py-3 pr-4 text-ink">{formatMoney(inv.amountCents, inv.currency)}</td>
                    <td className="py-3 pr-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE[inv.status] || TONE.OPEN}`}>{inv.status}</span></td>
                    <td className="py-3 text-right"><LinkButton href={inv.hostedUrl} icon={ExternalLink}>View</LinkButton><LinkButton href={inv.pdfUrl} icon={Download}>Download</LinkButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
