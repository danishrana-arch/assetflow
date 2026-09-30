import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Receipt, Check, X } from "lucide-react"
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

const TABS = [
  { key: "PENDING", label: "Awaiting verification" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
  { key: "", label: "All" },
]

const CLAIM_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink" }

function money(n) {
  return `PKR ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDay(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

// HR / Admin / CEO verify employees' office-expense claims. Approving adds
// the amount to the employee's payslip for that month automatically.
export default function ExpenseClaims() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState("PENDING")
  const [message, setMessage] = useState(null) // { tone, text }

  const { data: claims, isLoading } = useQuery({
    queryKey: ["expense-claims", status],
    queryFn: () => api.get("/expense-claims", { params: status ? { status } : {} }).then((r) => r.data),
  })

  const { data: pendingClaims } = useQuery({
    queryKey: ["expense-claims", "PENDING"],
    queryFn: () => api.get("/expense-claims", { params: { status: "PENDING" } }).then((r) => r.data),
  })
  const pendingTotal = (pendingClaims || []).reduce((sum, c) => sum + Number(c.amount), 0)

  const onDone = (text) => {
    queryClient.invalidateQueries({ queryKey: ["expense-claims"] })
    queryClient.invalidateQueries({ queryKey: ["payroll"] })
    setMessage({ tone: "green", text })
  }
  const onError = (err) => setMessage({ tone: "pink", text: err.response?.data?.error || "Something went wrong — please try again" })

  const approve = useMutation({
    mutationFn: (id) => api.post(`/expense-claims/${id}/approve`).then((r) => r.data),
    onSuccess: (c) => onDone(`Approved — ${money(c.amount)} added to ${c.employee.name}'s ${MONTHS[c.payrollMonth - 1]} ${c.payrollYear} payslip.`),
    onError,
  })

  const reject = useMutation({
    mutationFn: ({ id, note }) => api.post(`/expense-claims/${id}/reject`, { note }).then((r) => r.data),
    onSuccess: (c) => onDone(`Rejected ${c.employee.name}'s "${c.title}".`),
    onError,
  })

  function handleReject(c) {
    const note = window.prompt(`Reject "${c.title}" (${money(c.amount)})?\nOptional reason for ${c.employee.name}:`, "")
    if (note === null) return
    reject.mutate({ id: c.id, note })
  }

  const busy = approve.isPending || reject.isPending

  return (
    <div>
      <PageHeader
        title="Expense claims"
        subtitle="Office expenses employees paid themselves. Approving adds the amount to that month's payslip."
        backTo=""
        stats={[
          { label: "Awaiting verification", value: pendingClaims?.length ?? "—", icon: Receipt },
          { label: "Pending value", value: money(pendingTotal) },
        ]}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || "all"}
            onClick={() => { setStatus(t.key); setMessage(null) }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              status === t.key ? "bg-accent text-white" : "border border-border-strong bg-surface text-ink hover:bg-surface-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {message && (
        <div className={`mb-4 rounded-2xl px-4 py-3 text-xs ${message.tone === "green" ? "bg-chip-green-bg text-chip-green-fg" : "bg-chip-pink-bg text-chip-pink-fg"}`}>
          {message.text}
        </div>
      )}

      {!isLoading && claims?.length === 0 && (
        <EmptyState
          icon={Receipt}
          title={status === "PENDING" ? "Nothing to verify" : "No claims here"}
          description="Employees add office expenses from their My Payslips page."
        />
      )}

      <div className="space-y-3">
        {(claims || []).map((c) => {
          const isOwn = c.employeeId === user?.id
          return (
            <div key={c.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={c.employee?.name} size="sm" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{c.title}</span>
                    <StatusPill tone={CLAIM_TONE[c.status]}>{c.status}</StatusPill>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">
                    {c.employee?.name}
                    {c.employee?.department?.name ? ` · ${c.employee.department.name}` : ""} · spent {formatDay(c.expenseDate)}
                  </div>
                  {c.description && <div className="mt-1 text-xs text-muted">{c.description}</div>}
                  {c.status !== "PENDING" && c.reviewedBy && (
                    <div className="mt-1 text-xs text-muted-2">
                      {c.status === "APPROVED" ? "Approved" : "Rejected"} by {c.reviewedBy.name}
                      {c.status === "APPROVED" && c.payrollMonth ? ` · on ${MONTHS[c.payrollMonth - 1]} ${c.payrollYear} payslip` : ""}
                      {c.reviewNote ? ` — ${c.reviewNote}` : ""}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                <span className={`font-mono text-sm font-semibold ${c.status === "APPROVED" ? "text-chip-green-fg" : "text-ink"}`}>
                  {money(c.amount)}
                </span>
                {c.status === "PENDING" && !isOwn && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approve.mutate(c.id)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(c)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-danger hover:bg-chip-pink-bg disabled:opacity-60"
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                )}
                {c.status === "PENDING" && isOwn && (
                  <span className="text-xs text-muted-2">Your own claim — another reviewer must verify it</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
