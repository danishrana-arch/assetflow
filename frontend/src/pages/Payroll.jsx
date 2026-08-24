import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Wallet, Play, Send, CheckCircle2, XCircle, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const STATUS_TONE = { DRAFT: "slate", PENDING_APPROVAL: "yellow", PAID: "green" }

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function Payroll() {
  const { user } = useAuth()
  const isAdmin = user?.role === "ADMIN"
  const isCeo = user?.role === "CEO"
  const queryClient = useQueryClient()
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [editing, setEditing] = useState(null) // { id, bonus, deductions }

  const { data: records, isLoading } = useQuery({
    queryKey: ["payroll", month, year],
    queryFn: () => api.get("/payroll", { params: { month, year } }).then((r) => r.data),
  })

  const totals = useMemo(() => {
    if (!records) return { net: 0, paid: 0, draft: 0, pending: 0 }
    return records.reduce(
      (acc, r) => ({
        net: acc.net + Number(r.netPay),
        paid: acc.paid + (r.status === "PAID" ? 1 : 0),
        draft: acc.draft + (r.status === "DRAFT" ? 1 : 0),
        pending: acc.pending + (r.status === "PENDING_APPROVAL" ? 1 : 0),
      }),
      { net: 0, paid: 0, draft: 0, pending: 0 }
    )
  }, [records])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["payroll", month, year] })

  const generate = useMutation({
    mutationFn: () => api.post("/payroll/generate", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const save = useMutation({
    mutationFn: ({ id, bonus, deductions }) =>
      api.patch(`/payroll/${id}`, { bonus, deductions }).then((r) => r.data),
    onSuccess: () => { setEditing(null); invalidate() },
  })

  const markPaid = useMutation({
    mutationFn: (id) => api.post(`/payroll/${id}/mark-paid`).then((r) => r.data),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/payroll/${id}`),
    onSuccess: invalidate,
  })

  // Admin's final step — sends every DRAFT record this month to the CEO.
  const submit = useMutation({
    mutationFn: () => api.post("/payroll/submit", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  // CEO's sign-off — approves and pays every PENDING_APPROVAL record at
  // once, "delivered to every account" in one click.
  const approveAll = useMutation({
    mutationFn: () => api.post("/payroll/approve", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const rejectAll = useMutation({
    mutationFn: () => api.post("/payroll/reject", { month, year }).then((r) => r.data),
    onSuccess: invalidate,
  })

  const deleteAll = useMutation({
    mutationFn: () => api.delete("/payroll/bulk", { data: { month, year } }).then((r) => r.data),
    onSuccess: invalidate,
  })

  function shiftMonth(delta) {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y += 1 }
    if (m < 1) { m = 12; y -= 1 }
    setMonth(m); setYear(y)
  }

  function handleDeleteAll() {
    if (window.confirm(`Delete every non-paid payslip for ${MONTHS[month - 1]} ${year}? This can't be undone.`)) {
      deleteAll.mutate()
    }
  }

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Generate, review, and pay the monthly run in PKR."
        stats={[
          { label: "Net payout", value: money(totals.net), icon: Wallet },
          { label: "Draft", value: totals.draft },
          { label: "Pending approval", value: totals.pending },
          { label: "Paid", value: totals.paid },
        ]}
        actions={
      <>
        <div className="flex items-center gap-1 rounded-full border border-border-strong bg-surface px-1.5 py-1">
          <button onClick={() => shiftMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Previous month">
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-[130px] text-center text-sm font-semibold text-ink">
            {MONTHS[month - 1]} {year}
          </span>
          <button onClick={() => shiftMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2" aria-label="Next month">
            <ChevronRight size={15} />
          </button>
        </div>

      {isAdmin && (
        <>
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Play size={14} />
            {generate.isPending ? "Generating…" : "Generate"}
          </button>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || totals.draft === 0}
            title={totals.draft === 0 ? "No draft payslips to submit" : "Send to the CEO for approval"}
            className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
          >
            <Send size={14} />
            {submit.isPending ? "Submitting…" : "Submit for Approval"}
          </button>
        </>
      )}

    {isCeo && (
      <>
        <button
          onClick={() => approveAll.mutate()}
          disabled={approveAll.isPending || totals.pending === 0}
          title={totals.pending === 0 ? "Nothing pending approval" : "Approve and pay everyone at once, from your account"}
          className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <CheckCircle2 size={14} />
          {approveAll.isPending ? "Paying…" : "Approve & Pay All"}
        </button>
        <button
          onClick={() => rejectAll.mutate()}
          disabled={rejectAll.isPending || totals.pending === 0}
          className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2 disabled:opacity-40"
        >
          <XCircle size={14} /> Reject
        </button>
        <button
          onClick={handleDeleteAll}
          disabled={deleteAll.isPending || (totals.draft === 0 && totals.pending === 0)}
          title="Delete every non-paid payslip for this month, in one go"
          className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-danger hover:bg-chip-pink-bg disabled:opacity-40"
        >
          <Trash2 size={14} /> Delete All
        </button>
      </>
    )}
          </>
        }
      />

      {generate.data?.message && (
        <div className="mb-4 rounded-2xl bg-chip-yellow-bg px-4 py-3 text-xs text-chip-yellow-fg">
          {generate.data.message}
        </div>
      )}
      {generate.isSuccess && !generate.data?.message && (
        <div className="mb-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-xs text-chip-green-fg">
          {generate.data.created} record(s) created, {generate.data.skipped} already existed for this month.
        </div>
      )}
      {(submit.isError || approveAll.isError || rejectAll.isError || deleteAll.isError) && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-xs text-chip-pink-fg">
          {submit.error?.response?.data?.error || approveAll.error?.response?.data?.error || rejectAll.error?.response?.data?.error || deleteAll.error?.response?.data?.error}
        </div>
      )}
      {approveAll.isSuccess && (
        <div className="mb-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-xs text-chip-green-fg">
          {approveAll.data.paid} payslip(s) approved and delivered to every account.
        </div>
      )}

      <div className="overflow-hidden rounded-card bg-surface shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
                <th className="px-5 py-3 font-semibold">Employee</th>
                <th className="px-5 py-3 font-semibold">Bank Account</th>
                <th className="px-5 py-3 font-semibold">Base</th>
                <th className="px-5 py-3 font-semibold">Bonus</th>
                <th className="px-5 py-3 font-semibold">Deductions</th>
                <th className="px-5 py-3 font-semibold">Absences</th>
                <th className="px-5 py-3 font-semibold">Net pay</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
    <tbody className="divide-y divide-border">
      {(records || []).map((r) => {
        const isEditing = editing?.id === r.id
        const isDraft = r.status === "DRAFT"
        const isPaid = r.status === "PAID"
        return (
          <tr key={r.id} className="align-middle">
            <td className="px-5 py-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={r.employee?.name} size="sm" />
                <div>
                  <div className="font-medium text-ink">{r.employee?.name}</div>
                  <div className="text-xs text-muted">{r.employee?.department?.name || "—"}</div>
                </div>
              </div>
            </td>
            <td className="px-5 py-3">
              <div className="text-xs text-ink">{r.bankName || "—"}</div>
              <div className="font-mono text-[11px] text-muted">{r.bankAccountNumber || "No account on file"}</div>
            </td>
            <td className="px-5 py-3 font-mono text-xs text-ink">{money(r.baseSalary)}</td>
            <td className="px-5 py-3">
              {isEditing ? (
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={editing.bonus}
                  onChange={(e) => setEditing((s) => ({ ...s, bonus: e.target.value }))}
                  className="w-24 rounded-lg border border-border-strong bg-canvas px-2 py-1 font-mono text-xs"
                />
              ) : (
                <span className="font-mono text-xs text-chip-green-fg">+{money(r.bonus)}</span>
              )}
            </td>
            <td className="px-5 py-3">
              {isEditing ? (
                <input
                  type="number"
                  min="1000"
                  step="1000"
                  value={editing.deductions}
                  onChange={(e) => setEditing((s) => ({ ...s, deductions: e.target.value }))}
                  className="w-24 rounded-lg border border-border-strong bg-canvas px-2 py-1 font-mono text-xs"
                />
              ) : (
                <span className="font-mono text-xs text-chip-pink-fg">-{money(r.deductions)}</span>
              )}
            </td>
            <td className="px-5 py-3 text-xs text-muted">
              {r.unpaidLeaveDays > 0 && <div>{r.unpaidLeaveDays} unpaid day{r.unpaidLeaveDays === 1 ? "" : "s"}</div>}
              {r.halfDayLeaveDays > 0 && <div>{r.halfDayLeaveDays} half-day{r.halfDayLeaveDays === 1 ? "" : "s"}</div>}
              {r.lateDays > 0 && <div>{r.lateDays} late</div>}
              {!r.unpaidLeaveDays && !r.halfDayLeaveDays && !r.lateDays && "—"}
            </td>
            <td className="px-5 py-3 font-mono text-sm font-semibold text-ink">{money(r.netPay)}</td>
            <td className="px-5 py-3">
              <StatusPill tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</StatusPill>
            </td>
            <td className="px-5 py-3">
              <div className="flex items-center justify-end gap-2">
                {isDraft && isAdmin && isEditing && (
                  <button
                    onClick={() => save.mutate({ id: r.id, bonus: editing.bonus, deductions: editing.deductions })}
                    disabled={save.isPending}
                    className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Save
                  </button>
                )}
                {isDraft && isAdmin && !isEditing && (
                  <button
                    onClick={() => setEditing({ id: r.id, bonus: r.bonus, deductions: r.deductions })}
                    className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"
                  >
                    Edit
                  </button>
                )}
                {!isPaid && isCeo && (
                  <button
                    onClick={() => markPaid.mutate(r.id)}
                    disabled={markPaid.isPending}
                    title="Mark this one paid"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-chip-green-fg hover:bg-chip-green-bg"
                  >
                    <CheckCircle2 size={16} />
                  </button>
                )}
                {!isPaid && (isAdmin || isCeo) && (
                  <button
                    onClick={() => remove.mutate(r.id)}
                    disabled={remove.isPending}
                    title="Delete record"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-chip-pink-fg hover:bg-chip-pink-bg"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </td>
          </tr>
        )
              })}
            </tbody>
          </table>
        </div>

        {!isLoading && records?.length === 0 && (
          <EmptyState
            icon={Wallet}
            title="No payroll for this month yet"
            description="Generate it from active employees with a base salary set. Employees without a base salary are skipped add one from their profile."
            className="my-4"
          />
        )}
      </div>
    </div>
  )
}