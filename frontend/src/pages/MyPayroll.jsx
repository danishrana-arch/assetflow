import { useQuery } from "@tanstack/react-query"
import { Wallet } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_TONE = { DRAFT: "slate", PENDING_APPROVAL: "yellow", PAID: "green" }

export default function MyPayroll() {
  const { data: records, isLoading } = useQuery({
    queryKey: ["my-payroll"],
    queryFn: () => api.get("/payroll/me").then((r) => r.data),
  })

  return (
    <div>
      <PageHeader title="My payslips" subtitle="Your monthly pay history." backTo="/" />

      {!isLoading && records?.length === 0 && (
        <EmptyState
          icon={Wallet}
          title="No payslips yet"
          description="Your payslips will appear here once payroll has been generated and reviewed for a month you were active."
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(records || []).map((r) => (
          <div key={r.id} className="rounded-card bg-surface p-5 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold text-ink">
                  {MONTHS[r.month - 1]} {r.year}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {r.paidAt ? `Paid ${new Date(r.paidAt).toLocaleDateString()}` : "Not yet paid"}
                </div>
              </div>
              <StatusPill tone={STATUS_TONE[r.status] || "slate"}>{r.status.replace("_", " ")}</StatusPill>
            </div>

            <div className="mt-4 space-y-1.5 text-xs">
              <div className="flex justify-between text-muted">
                <span>Base salary</span>
                <span className="font-mono text-ink">{money(r.baseSalary)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Bonus</span>
                <span className="font-mono text-chip-green-fg">+{money(r.bonus)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>
                  Deductions
                  {(r.unpaidLeaveDays || r.halfDayLeaveDays || r.lateDays) && (
                    <>
                      {" "}(
                      {[
                        r.unpaidLeaveDays ? `${r.unpaidLeaveDays} unpaid day${r.unpaidLeaveDays === 1 ? "" : "s"}` : null,
                        r.halfDayLeaveDays ? `${r.halfDayLeaveDays} half-day${r.halfDayLeaveDays === 1 ? "" : "s"}` : null,
                        r.lateDays ? `${r.lateDays} late` : null,
                      ].filter(Boolean).join(", ")}
                      )
                    </>
                  )}
                </span>
                <span className="font-mono text-chip-pink-fg">-{money(r.deductions)}</span>
              </div>
              {r.bankAccountNumber && (
                <div className="flex justify-between text-muted">
                  <span>Paid to</span>
                  <span className="font-mono text-ink">{r.bankName} · {r.bankAccountNumber}</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-xs font-medium text-muted">Net pay</span>
              <span className="font-mono text-lg font-semibold text-ink">{money(r.netPay)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
