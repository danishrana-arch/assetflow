import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, XCircle, Palmtree, Send, Ban, MapPin, AlertTriangle } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import StatusPill from "../components/ui/StatusPill"
import { TextField, TextAreaField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const ATTENDANCE_TONE = { PRESENT: "green", ABSENT: "pink", LEAVE: "yellow" }
const LEAVE_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink", CANCELLED: "slate" }
const LEAVE_TYPE_LABELS = { SICK: "Sick", CASUAL: "Casual / Annual", UNPAID: "Unpaid" }

function fmt(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

function fmtTime(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export default function MyAttendance() {
  const queryClient = useQueryClient()
  const [leaveForm, setLeaveForm] = useState({ startDate: "", endDate: "", reason: "", type: "CASUAL" })
  const [leaveError, setLeaveError] = useState("")
  const [locating, setLocating] = useState(false)
  const [flagNotice, setFlagNotice] = useState(null)
  const [locationError, setLocationError] = useState("")

  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ["attendance-self"],
    queryFn: () => api.get("/attendance/self").then((r) => r.data),
  })

  const { data: leaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ["leaves-self"],
    queryFn: () => api.get("/leaves").then((r) => r.data),
  })

  const { data: balance } = useQuery({
    queryKey: ["leave-balance"],
    queryFn: () => api.get("/leaves/balance").then((r) => r.data),
  })

  const markToday = useMutation({
    mutationFn: ({ status, latitude, longitude }) => api.post("/attendance/self/mark", { status, latitude, longitude }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
      if (res.data?.autoFlagged) {
        setFlagNotice(
          "You were marked Absent because your location is outside the office premises. If you're working remotely or in the field today, ask your admin to review it or mark your account as a field employee."
        )
      } else {
        setFlagNotice(null)
      }
    },
  })

  function handleMark(status) {
    setFlagNotice(null)
    setLocationError("")

    if (status === "ABSENT") {
      markToday.mutate({ status })
      return
    }

    // Attendance on phones/tablets should always request location. This
    // provides a clear permission prompt and records the check-in location.
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(navigator.userAgent)
    if (!navigator.geolocation) {
      if (isMobile) {
        setLocationError("Location services are required to mark attendance from a mobile or tablet. Please enable location and try again.")
        return
      }
      markToday.mutate({ status })
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        markToday.mutate({ status, latitude: pos.coords.latitude, longitude: pos.coords.longitude })
      },
      (error) => {
        setLocating(false)
        setLocationError(
          error.code === 1
            ? "Location permission was denied. Please allow location access in your browser settings and try again."
            : "We couldn't get your location. Please turn on location services and try again."
        )
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const submitLeave = useMutation({
    mutationFn: () => api.post("/leaves", leaveForm),
    onSuccess: () => {
      setLeaveForm({ startDate: "", endDate: "", reason: "", type: "CASUAL" })
      setLeaveError("")
      queryClient.invalidateQueries({ queryKey: ["leaves-self"] })
      queryClient.invalidateQueries({ queryKey: ["leave-balance"] })
    },
    onError: (err) => setLeaveError(err.response?.data?.error || "Could not submit leave application"),
  })

  const cancelLeave = useMutation({
    mutationFn: (id) => api.delete(`/leaves/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leaves-self"] }),
  })

  function handleLeaveSubmit(e) {
    e.preventDefault()
    setLeaveError("")
    if (!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()) {
      setLeaveError("Please fill in the dates and a reason.")
      return
    }
    submitLeave.mutate()
  }

  const todayStatus = attendance?.today?.status
  const isOnLeaveToday = todayStatus === "LEAVE"

  return (
    <div>
      <PageHeader title="My Attendance" subtitle="Mark today's attendance and request time off." backTo="/" />

      {balance && (
        <details className="group mb-5 overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Leave balance</p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {balance.sick.remaining + balance.casual.remaining} paid days remaining
              </p>
            </div>
            <span className="rounded-xl bg-surface-2 px-3 py-2 text-xs font-semibold text-muted transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Sick Leave</p>
              <p className="mt-1 text-xl font-semibold text-ink">{balance.sick.remaining}<span className="text-sm font-normal text-muted-2"> / {balance.sick.total} left</span></p>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Casual Leave</p>
              <p className="mt-1 text-xl font-semibold text-ink">{balance.casual.remaining}<span className="text-sm font-normal text-muted-2"> / {balance.casual.total} left</span></p>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Unpaid Taken</p>
              <p className="mt-1 text-xl font-semibold text-ink">{balance.unpaid.used}<span className="text-sm font-normal text-muted-2"> days this year</span></p>
            </div>
          </div>
        </details>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Mark today */}
        <div className="card p-6">
          <SectionHeader title="Today" />
          {loadingAttendance ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : isOnLeaveToday ? (
            <div className="flex items-center gap-3 rounded-2xl bg-chip-yellow-bg px-4 py-3">
              <Palmtree size={18} className="text-chip-yellow-fg" />
              <p className="text-sm font-semibold text-chip-yellow-fg">You're on approved leave today.</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                Current status:{" "}
                {todayStatus ? (
                  <StatusPill tone={ATTENDANCE_TONE[todayStatus]}>{todayStatus}</StatusPill>
                ) : (
                  <span className="font-medium text-muted-2">Not marked yet</span>
                )}
              </p>
              {attendance?.today?.updatedAt && (
                <p className="mb-3 text-sm text-muted-2">Marked at {fmtTime(attendance.today.updatedAt)}</p>
              )}
              {attendance?.today?.autoFlagged && (
                <div className="mb-3 flex items-start gap-2 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-xs text-chip-pink-fg">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>Auto-marked Absent — your last check-in location was outside the office. Your admin can review and override this.</span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => handleMark("PRESENT")}
                  disabled={markToday.isPending || locating}
                  className="pill-accent flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  {locating ? <MapPin size={15} className="animate-pulse" /> : <CheckCircle2 size={15} />}
                  {locating ? "Locating…" : "Mark Present"}
                </button>
                <button
                  onClick={() => handleMark("ABSENT")}
                  disabled={markToday.isPending || locating}
                  className="pill-secondary flex flex-1 items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60"
                >
                  <XCircle size={15} /> Mark Absent
                </button>
              </div>
              <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-2">
                <MapPin size={11} /> Your location is checked against the office when you mark yourself Present.
              </p>
              {locationError && (
                <div className="mt-3 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-xs font-medium text-chip-pink-fg">
                  {locationError}
                </div>
              )}
              {flagNotice && (
                <div className="mt-3 flex items-start gap-2 rounded-2xl bg-chip-yellow-bg px-3.5 py-2.5 text-xs text-chip-yellow-fg">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{flagNotice}</span>
                </div>
              )}
            </>
          )}

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Last 30 days</p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {(attendance?.history || []).map((r) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{fmt(r.date)}</span>
                  <StatusPill tone={ATTENDANCE_TONE[r.status]}>{r.status}</StatusPill>
                </li>
              ))}
              {(attendance?.history || []).length === 0 && (
                <li className="text-sm text-muted">No attendance recorded yet.</li>
              )}
            </ul>
          </div>
        </div>

        {/* Leave application */}
        <div className="card p-6">
          <SectionHeader title="Request Leave" />
          <form onSubmit={handleLeaveSubmit} className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Type"
              value={leaveForm.type}
              onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))}
              className="sm:col-span-2"
            >
              {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </SelectField>
            <TextField
              label="From"
              type="date"
              value={leaveForm.startDate}
              onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
            <TextField
              label="To"
              type="date"
              value={leaveForm.endDate}
              onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))}
              required
            />
            <TextAreaField
              label="Reason"
              value={leaveForm.reason}
              onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))}
              className="sm:col-span-2"
              required
            />
            {leaveError && (
              <div className="sm:col-span-2 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
                {leaveError}
              </div>
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitLeave.isPending}
                className="pill-accent flex items-center gap-1.5 px-5 py-2.5 text-sm disabled:opacity-60"
              >
                <Send size={14} />
                {submitLeave.isPending ? "Submitting…" : "Submit Application"}
              </button>
            </div>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your applications</p>
            {loadingLeaves && <p className="text-sm text-muted">Loading…</p>}
            <ul className="space-y-2">
              {(leaves || []).map((leave) => (
                <li key={leave.id} className="rounded-2xl bg-surface-2 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {fmt(leave.startDate)} — {fmt(leave.endDate)}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <StatusPill tone="slate">{LEAVE_TYPE_LABELS[leave.type] || leave.type}</StatusPill>
                      <StatusPill tone={LEAVE_TONE[leave.status]}>{leave.status}</StatusPill>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">{leave.reason}</p>
                  {leave.status === "PENDING" && (
                    <button
                      onClick={() => cancelLeave.mutate(leave.id)}
                      disabled={cancelLeave.isPending}
                      className="mt-2 flex items-center gap-1 text-xs font-semibold text-danger hover:underline"
                    >
                      <Ban size={12} /> Cancel request
                    </button>
                  )}
                  {leave.reviewNote && (
                    <p className="mt-1.5 text-xs italic text-muted-2">Note: {leave.reviewNote}</p>
                  )}
                </li>
              ))}
              {(leaves || []).length === 0 && !loadingLeaves && (
                <EmptyState title="No leave applications yet" description="Submit one using the form above." />
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
