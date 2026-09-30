import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Wallet, ChevronLeft, ChevronRight, ChevronDown, Plus, Receipt, Trash2, UserX, Download } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"
import { TextField } from "../components/ui/Field"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Expense dates are stored as UTC midnight of the picked day.
function formatDay(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

function isoDay(date) {
  return date.toISOString().slice(0, 10)
}

const STATUS_TONE = { DRAFT: "slate", PENDING_APPROVAL: "yellow", PAID: "green" }
const CLAIM_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink" }

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

// One payslip line. tone "add" = green "+", "deduct" = red "−".
function Line({ label, detail, amount, tone }) {
  const color = tone === "add" ? "text-chip-green-fg" : tone === "deduct" ? "text-chip-pink-fg" : "text-ink"
  const sign = tone === "add" ? "+" : tone === "deduct" ? "−" : ""
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted">
        {label}
        {detail && <span className="ml-1 text-xs text-muted-2">({detail})</span>}
      </span>
      <span className={`shrink-0 font-mono ${color}`}>{sign}{money(amount)}</span>
    </div>
  )
}

export default function MyPayroll() {
  const queryClient = useQueryClient()
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  const currentYear = now.getFullYear()
  const [month, setMonth] = useState(currentMonth)
  const [year, setYear] = useState(currentYear)
  const [expensesOpen, setExpensesOpen] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: "", amount: "", expenseDate: "", description: "" })
  const [formError, setFormError] = useState("")
  const [sentMessage, setSentMessage] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")

  const { data: records, isLoading, isError, error } = useQuery({
    queryKey: ["my-payroll"],
    queryFn: () => api.get("/payroll/me").then((r) => r.data),
  })

  const { data: claims } = useQuery({
    queryKey: ["my-expense-claims"],
    queryFn: () => api.get("/expense-claims/me").then((r) => r.data),
  })

  const record = (records || []).find((r) => r.month === month && r.year === year)
  const isCurrentMonth = month === currentMonth && year === currentYear

  // Approved claims belong to the month they were paid on; pending and
  // rejected ones are shown under the month the expense was made in.
  const monthClaims = useMemo(
    () =>
      (claims || []).filter((c) => {
        if (c.status === "APPROVED") return c.payrollMonth === month && c.payrollYear === year
        const d = new Date(c.expenseDate)
        return d.getUTCMonth() + 1 === month && d.getUTCFullYear() === year
      }),
    [claims, month, year]
  )
  const pendingTotal = monthClaims.filter((c) => c.status === "PENDING").reduce((sum, c) => sum + Number(c.amount), 0)

  function shiftMonth(delta) {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y += 1 }
    if (m < 1) { m = 12; y -= 1 }
    setMonth(m); setYear(y)
    setShowForm(false); setFormError(""); setSentMessage("")
  }

  function openForm() {
    // Default the date to today in the current month, otherwise the last
    // day of the month being viewed.
    const defaultDate = isCurrentMonth ? isoDay(new Date(Date.UTC(currentYear, now.getMonth(), now.getDate()))) : isoDay(new Date(Date.UTC(year, month, 0)))
    setForm({ title: "", amount: "", expenseDate: defaultDate, description: "" })
    setFormError(""); setSentMessage("")
    setShowForm(true); setExpensesOpen(true)
  }

  const submitClaim = useMutation({
    mutationFn: (body) => api.post("/expense-claims", body).then((r) => r.data),
    onSuccess: (claim) => {
      queryClient.invalidateQueries({ queryKey: ["my-expense-claims"] })
      setShowForm(false)
      setSentMessage(`"${claim.title}" was sent to HR for verification.`)
    },
    onError: (err) => setFormError(err.response?.data?.error || "Could not submit — please try again"),
  })

  const withdrawClaim = useMutation({
    mutationFn: (id) => api.delete(`/expense-claims/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-expense-claims"] }),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setFormError("Title is required.")
    if (!(Number(form.amount) > 0)) return setFormError("Enter an amount greater than 0.")
    setFormError("")
    submitClaim.mutate({ ...form, title: form.title.trim(), amount: Number(form.amount) })
  }

  // Fetched through the API client (not a plain link) so the auth header
  // is sent; the blob is then saved as a file.
  async function downloadPdf() {
    if (!record) return
    setDownloading(true); setDownloadError("")
    try {
      const res = await api.get(`/payroll/${record.id}/pdf`, { responseType: "blob" })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement("a")
      a.href = url
      a.download = `payslip-${year}-${String(month).padStart(2, "0")}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setDownloadError("Couldn't download the payslip — please try again.")
    } finally {
      setDownloading(false)
    }
  }

  const leaveDetail = record
    ? [
        record.absentDays ? `${plural(record.absentDays, "day")} absent` : null,
        record.unpaidLeaveDays ? `${plural(record.unpaidLeaveDays, "day")} unpaid leave` : null,
        record.halfDayLeaveDays ? plural(record.halfDayLeaveDays, "half-day") : null,
      ].filter(Boolean).join(", ")
    : ""

  return (
    <div>
      <PageHeader
        title="My payslips"
        subtitle="Your monthly payroll summary and office expense claims. Download payslips as PDF for your records."
        backTo="/"
        actions={
          <>
          <button
            onClick={downloadPdf}
            disabled={!record || downloading}
            title={record ? `Download the ${MONTHS[month - 1]} ${year} payslip as PDF` : "No payslip for this month"}
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Download size={14} />
            {downloading ? "Preparing…" : "Download PDF"}
          </button>
          <div className="flex items-center gap-1 rounded-full border border-border-strong bg-surface px-1.5 py-1">
            <button onClick={() => shiftMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Previous month">
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[130px] text-center text-sm font-semibold text-ink">
              {MONTHS[month - 1]} {year}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              disabled={isCurrentMonth}
              className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          </>
        }
      />

      {downloadError && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-xs text-chip-pink-fg">{downloadError}</div>
      )}

      {isError && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-xs text-chip-pink-fg">
          Couldn't load your payslips: {error?.response?.data?.error || error?.message || "server error"}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Payslip */}
        <div className="rounded-card bg-surface p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-ink">Payslip · {MONTHS[month - 1]} {year}</div>
              {record && (
                <div className="mt-0.5 text-xs text-muted">
                  {record.paidAt ? `Paid ${new Date(record.paidAt).toLocaleDateString()}` : "Not yet paid"}
                </div>
              )}
            </div>
            {record && <StatusPill tone={STATUS_TONE[record.status] || "slate"}>{record.status.replace("_", " ")}</StatusPill>}
          </div>

          {!isLoading && !isError && !record && (
            <EmptyState
              icon={Wallet}
              title="No payslip for this month"
              description={
                isCurrentMonth
                  ? "This month's payslip appears once payroll is generated. Use ‹ to see previous months."
                  : "Payroll wasn't generated for you this month."
              }
              className="my-4"
            />
          )}

          {record && (
            <>
              {record.terminationDate && (
                <div className="mt-4 flex gap-2 rounded-2xl bg-chip-orange-bg px-3 py-2.5 text-xs text-chip-orange-fg">
                  <UserX size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Final settlement — employment ended {formatDay(record.terminationDate)}</div>
                    {record.terminationNote && <div className="mt-0.5">{record.terminationNote}</div>}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Earnings</p>
                <Line label="Basic pay" amount={record.baseSalary} />
                <Line label="Bonus" amount={record.bonus} tone="add" />
                {Number(record.performanceBonus) > 0 && (
                  <Line label="Performance bonus" detail="from your performance review" amount={record.performanceBonus} tone="add" />
                )}
                {Number(record.expenseReimbursement) > 0 && (
                  <Line label="Office expenses" detail="reimbursed" amount={record.expenseReimbursement} tone="add" />
                )}
                {Number(record.terminationSettlement) > 0 && (
                  <Line label="Termination settlement" amount={record.terminationSettlement} tone="add" />
                )}
              </div>

              <div className="mt-3 border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">Deductions</p>
                <Line label="Tax" detail={Number(record.taxPercent) ? `${Number(record.taxPercent)}%` : null} amount={record.tax} tone="deduct" />
                <Line label="Absent" detail={leaveDetail || null} amount={record.absentDeduction} tone="deduct" />
                <Line label="Late" detail={record.lateDays ? plural(record.lateDays, "day") : null} amount={record.lateDeduction} tone="deduct" />
                {Number(record.otherDeduction) > 0 && <Line label="Other deductions" amount={record.otherDeduction} tone="deduct" />}
                {Number(record.terminationDeduction) > 0 && (
                  <Line label="Termination deduction" amount={record.terminationDeduction} tone="deduct" />
                )}
              </div>

              <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                <span className="text-sm font-semibold text-ink">Total</span>
                <span className="font-mono text-xl font-semibold text-ink">{money(record.netPay)}</span>
              </div>

              {record.note && <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">{record.note}</p>}
              {record.bankAccountNumber && (
                <div className="mt-3 flex justify-between text-xs text-muted">
                  <span>Paid to</span>
                  <span className="font-mono text-ink">{record.bankName} · {record.bankAccountNumber}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Office expenses */}
        <div className="self-start rounded-card bg-surface shadow-card">
          <button
            onClick={() => setExpensesOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 p-5 text-left"
            aria-expanded={expensesOpen}
          >
            <div className="flex items-center gap-2.5">
              <Receipt size={17} className="text-muted" />
              <div>
                <div className="text-sm font-semibold text-ink">Office expenses · {MONTHS[month - 1]}</div>
                <div className="text-xs text-muted">
                  {monthClaims.length ? plural(monthClaims.length, "claim") : "Paid for something the office should have?"}
                  {pendingTotal > 0 && ` · ${money(pendingTotal)} awaiting HR`}
                </div>
              </div>
            </div>
            <ChevronDown size={17} className={`shrink-0 text-muted transition-transform ${expensesOpen ? "rotate-180" : ""}`} />
          </button>

          {expensesOpen && (
            <div className="border-t border-border px-5 pb-5 pt-3">
              {monthClaims.length > 0 && (
                <ul className="divide-y divide-border">
                  {monthClaims.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{c.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{formatDay(c.expenseDate)}</span>
                          <StatusPill tone={CLAIM_TONE[c.status]}>{c.status === "PENDING" ? "Awaiting HR" : c.status}</StatusPill>
                        </div>
                        {c.status === "APPROVED" && c.reviewedBy && (
                          <div className="mt-1 text-xs text-muted-2">Verified by {c.reviewedBy.name}</div>
                        )}
                        {c.status === "REJECTED" && c.reviewNote && (
                          <div className="mt-1 text-xs text-chip-pink-fg">{c.reviewNote}</div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className={`font-mono text-sm ${c.status === "APPROVED" ? "text-chip-green-fg" : c.status === "REJECTED" ? "text-muted-2 line-through" : "text-ink"}`}>
                          {c.status === "APPROVED" ? "+" : ""}{money(c.amount)}
                        </span>
                        {c.status === "PENDING" && (
                          <button
                            onClick={() => window.confirm(`Withdraw "${c.title}"?`) && withdrawClaim.mutate(c.id)}
                            disabled={withdrawClaim.isPending}
                            title="Withdraw claim"
                            className="flex h-7 w-7 items-center justify-center rounded-full text-chip-pink-fg hover:bg-chip-pink-bg"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {sentMessage && (
                <div className="mt-2 rounded-2xl bg-chip-green-bg px-3 py-2 text-xs text-chip-green-fg">{sentMessage}</div>
              )}

              {showForm ? (
                <form onSubmit={handleSubmit} className="mt-3 space-y-3 rounded-2xl border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label="Title"
                      placeholder="e.g. Tea for office"
                      maxLength={120}
                      value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    />
                    <TextField
                      label="Value (PKR)"
                      type="number"
                      min="1"
                      step="any"
                      placeholder="0"
                      value={form.amount}
                      onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    />
                  </div>
                  <TextField
                    label="Date"
                    type="date"
                    max={isoDay(new Date())}
                    value={form.expenseDate}
                    onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
                  />
                  <TextField
                    label="Note (optional)"
                    placeholder="Anything HR should know"
                    maxLength={1000}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  />
                  {formError && <p className="text-xs text-chip-pink-fg">{formError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitClaim.isPending}
                      className="rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      {submitClaim.isPending ? "Sending…" : "Send to HR"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={openForm}
                  className="mt-3 flex items-center gap-1.5 rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
                >
                  <Plus size={13} /> Add expense
                </button>
              )}
              <p className="mt-3 text-xs text-muted-2">
                Once HR or an admin approves a claim, it's added to that month's payslip automatically (or the next open
                one if that payslip was already sent for payment).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
