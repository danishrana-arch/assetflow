import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Check, X, Clock, CheckCircle2, XCircle, Search, CalendarDays } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import { SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"
import useMarkNotificationsRead from "../hooks/useMarkNotificationsRead"

const LEAVE_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink", CANCELLED: "slate" }
const LEAVE_TYPE_LABELS = { SICK: "Sick", CASUAL: "Annual", UNPAID: "Unpaid" }
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function fmt(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

// Calendar days in the request (half-day = 0.5). The balance endpoint counts
// chargeable days (skipping weekends/holidays), so this is an upper bound.
function requestDays(leave) {
  if (leave.isHalfDay) return 0.5
  return Math.round((new Date(leave.endDate) - new Date(leave.startDate)) / 86400000) + 1
}

function payrollMonths(leave) {
  const s = new Date(leave.startDate), e = new Date(leave.endDate)
  const first = `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`
  const last = `${MONTHS[e.getUTCMonth()]} ${e.getUTCFullYear()}`
  return first === last ? first : `${first} – ${last}`
}

// What approving this request does, in plain words, plus the employee's
// remaining balance for paid leave types (GET /leaves/balance, existing).
function LeaveImpact({ leave }) {
  const { data: balance } = useQuery({
    queryKey: ["leave-balance", leave.employeeId, new Date(leave.startDate).getUTCFullYear()],
    queryFn: () =>
      api.get("/leaves/balance", { params: { employeeId: leave.employeeId, year: new Date(leave.startDate).getUTCFullYear() } }).then((r) => r.data),
    enabled: leave.status === "PENDING" && leave.type !== "UNPAID",
    staleTime: 60000,
  })
  const days = requestDays(leave)
  const bucket = leave.type === "SICK" ? balance?.sick : leave.type === "CASUAL" ? balance?.casual : null
  const exceeds = bucket && days > bucket.remaining

  return (
    <div className="mt-2 space-y-0.5 text-[11px] text-muted">
      {leave.type === "UNPAID" ? (
        <p className="text-chip-pink-fg">Unpaid — deducted from the {payrollMonths(leave)} payslip once approved.</p>
      ) : bucket ? (
        <p className={exceeds ? "font-semibold text-chip-pink-fg" : ""}>
          {LEAVE_TYPE_LABELS[leave.type]} balance: {bucket.remaining} of {bucket.total} days left{exceeds ? ` — this request is up to ${days} days` : ""}.
        </p>
      ) : leave.status === "PENDING" ? (
        <p>Checking balance…</p>
      ) : null}
      {leave.status === "PENDING" && (
        <p>{leave.isHalfDay ? "Half day — attendance isn't changed." : "Approving marks these days as Leave on the attendance sheet."}</p>
      )}
    </div>
  )
}

export default function LeaveRequests() {
  useMarkNotificationsRead("LEAVE_REQUEST")
  const [statusFilter, setStatusFilter] = useState("PENDING")
  const [typeFilter, setTypeFilter] = useState("")
  const [search, setSearch] = useState("")
  const [conflictError, setConflictError] = useState(null) // { leaveId, message }
  const queryClient = useQueryClient()

  // One list for every status, so the counts above always match what the
  // status filter shows.
  const { data: allLeaves, isLoading, isError } = useQuery({
    queryKey: ["leaves", "all", typeFilter],
    queryFn: () => api.get("/leaves", { params: typeFilter ? { type: typeFilter } : {} }).then((r) => r.data),
  })

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 }
    for (const l of allLeaves || []) c[l.status] = (c[l.status] || 0) + 1
    return c
  }, [allLeaves])

  const leaves = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (allLeaves || []).filter((l) =>
      (!statusFilter || l.status === statusFilter) &&
      (!q || (l.employee?.name || "").toLowerCase().includes(q) || (l.employee?.department?.name || "").toLowerCase().includes(q))
    )
  }, [allLeaves, statusFilter, search])

  const review = useMutation({
    mutationFn: ({ id, decision, reviewNote }) => api.patch(`/leaves/${id}/review`, { decision, reviewNote }),
    onSuccess: () => {
      setConflictError(null)
      queryClient.invalidateQueries({ queryKey: ["leaves"] })
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] })
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (err, variables) => {
      setConflictError({ leaveId: variables.id, message: err.response?.data?.error || "Could not update this application" })
    },
  })

  function reject(leave) {
    const reviewNote = window.prompt(`Reason for rejecting ${leave.employee?.name}'s leave (optional, the employee sees it):`, "")
    if (reviewNote === null) return
    review.mutate({ id: leave.id, decision: "REJECTED", reviewNote })
  }

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Leave Requests"
        subtitle="Review and decide on employee leave applications. Approved leave updates attendance, and unpaid leave is deducted in payroll."
        stats={[
          { label: "Pending", value: counts.PENDING, icon: Clock },
          { label: "Approved", value: counts.APPROVED, icon: CheckCircle2 },
          { label: "Rejected", value: counts.REJECTED, icon: XCircle },
        ]}
        actions={
          <>
            <Link to="/calendar" className="pill-secondary flex items-center gap-1.5 px-4 py-2 text-sm">
              <CalendarDays size={14} /> Calendar
            </Link>
            <SelectField value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44">
              <option value="">All types</option>
              {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectField>
            <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              <option value="PENDING">Pending ({counts.PENDING})</option>
              <option value="APPROVED">Approved ({counts.APPROVED})</option>
              <option value="REJECTED">Rejected ({counts.REJECTED})</option>
              <option value="CANCELLED">Cancelled ({counts.CANCELLED})</option>
              <option value="">All statuses</option>
            </SelectField>
          </>
        }
      />

      <label className="mb-3 flex h-9 w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm focus-within:border-accent sm:w-72">
        <Search size={14} className="shrink-0 text-muted-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search employee or department"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-2"
          aria-label="Search employee"
        />
        {search && (
          <button type="button" onClick={() => setSearch("")} className="shrink-0 text-muted-2 hover:text-ink" aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </label>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {isError && <div className="mb-3 rounded-2xl bg-chip-pink-bg px-4 py-2.5 text-sm text-chip-pink-fg">Couldn't load leave requests.</div>}

      <div className="space-y-3">
        {leaves.map((leave) => (
          <div key={leave.id} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Avatar name={leave.employee?.name || "?"} size="md" />
              <div className="min-w-0">
                <Link to={`/employees/${leave.employeeId}`} className="text-sm font-semibold text-ink hover:underline">{leave.employee?.name}</Link>
                <p className="text-xs text-muted">
                  {fmt(leave.startDate)}{leave.isHalfDay ? " (half day)" : ` — ${fmt(leave.endDate)} · ${requestDays(leave)} day${requestDays(leave) === 1 ? "" : "s"}`}
                  {leave.employee?.department?.name ? ` · ${leave.employee.department.name}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-2">{leave.reason}</p>
                <LeaveImpact leave={leave} />
                {leave.status !== "PENDING" && leave.reviewedBy && (
                  <p className="mt-1 text-[11px] text-muted-2">
                    {leave.status === "APPROVED" ? "Approved" : leave.status === "REJECTED" ? "Rejected" : "Reviewed"} by {leave.reviewedBy.name}
                    {leave.reviewedAt ? ` on ${fmt(leave.reviewedAt)}` : ""}{leave.reviewNote ? ` — “${leave.reviewNote}”` : ""}
                  </p>
                )}
                {conflictError?.leaveId === leave.id && (
                  <p className="mt-1.5 text-xs font-medium text-danger">{conflictError.message}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="slate">{LEAVE_TYPE_LABELS[leave.type] || leave.type}</StatusPill>
              <StatusPill tone={LEAVE_TONE[leave.status]}>{leave.status}</StatusPill>
              {leave.status === "PENDING" && (
                <>
                  <button
                    onClick={() => review.mutate({ id: leave.id, decision: "APPROVED" })}
                    disabled={review.isPending}
                    className="pill-accent flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    <Check size={13} /> Approve
                  </button>
                  <button
                    onClick={() => reject(leave)}
                    disabled={review.isPending}
                    className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs text-danger disabled:opacity-60"
                  >
                    <X size={13} /> Reject
                  </button>
                </>
              )}
            </div>
          </div>
        ))}

        {leaves.length === 0 && !isLoading && !isError && (
          <EmptyState
            title={statusFilter === "PENDING" && !search ? "No leave waiting for a decision" : "No leave requests"}
            description={
              statusFilter === "PENDING" && !search
                ? "You're all caught up. New requests appear here and in your notifications."
                : "Nothing matches this filter right now — try another status or clear the search."
            }
          />
        )}
      </div>
    </div>
  )
}
