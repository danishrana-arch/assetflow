import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import { SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const LEAVE_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink", CANCELLED: "slate" }
const LEAVE_TYPE_LABELS = { SICK: "Sick", CASUAL: "Annual", UNPAID: "Unpaid" }

function fmt(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

export default function LeaveRequests() {
  const [statusFilter, setStatusFilter] = useState("PENDING")
  const [typeFilter, setTypeFilter] = useState("")
  const [conflictError, setConflictError] = useState(null) // { leaveId, message }
  const queryClient = useQueryClient()

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["leaves", statusFilter, typeFilter],
    queryFn: () =>
      api
        .get("/leaves", {
          params: { ...(statusFilter ? { status: statusFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}) },
        })
        .then((r) => r.data),
  })

  const review = useMutation({
    mutationFn: ({ id, decision }) => api.patch(`/leaves/${id}/review`, { decision }),
    onSuccess: () => {
      setConflictError(null)
      queryClient.invalidateQueries({ queryKey: ["leaves"] })
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] })
    },
    onError: (err, variables) => {
      setConflictError({ leaveId: variables.id, message: err.response?.data?.error || "Could not update this application" })
    },
  })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Leave Requests"
        subtitle="Review and decide on employee leave applications."
        actions={
          <>
            <SelectField value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-44">
              <option value="">All types</option>
              {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectField>
            <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="">All statuses</option>
            </SelectField>
          </>
        }
      />

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      <div className="space-y-3">
        {(leaves || []).map((leave) => (
          <div key={leave.id} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Avatar name={leave.employee?.name || "?"} size="md" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{leave.employee?.name}</p>
                <p className="text-xs text-muted">
                  {fmt(leave.startDate)} — {fmt(leave.endDate)}
                  {leave.employee?.department?.name ? ` · ${leave.employee.department.name}` : ""}
                </p>
                <p className="mt-1 text-xs text-muted-2">{leave.reason}</p>
                {conflictError?.leaveId === leave.id && (
                  <p className="mt-1.5 text-xs font-medium text-danger">{conflictError.message}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
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
                    onClick={() => review.mutate({ id: leave.id, decision: "REJECTED" })}
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

        {(leaves || []).length === 0 && !isLoading && (
          <EmptyState title="No leave requests" description="Nothing matches this filter right now." />
        )}
      </div>
    </div>
  )
}
