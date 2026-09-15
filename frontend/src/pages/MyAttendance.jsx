import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, XCircle, Palmtree, Send, Ban, MapPin, Wifi, WifiOff, RefreshCw, AlertTriangle } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import StatusPill from "../components/ui/StatusPill"
import { TextField, TextAreaField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"
import OfflineAttendanceVerification from "../components/OfflineAttendanceVerification"
import {
  getAttendanceDeviceId,
  getOfflineAttendanceQueue,
  queueOfflineAttendance,
  syncOfflineAttendanceQueue,
} from "../utils/offlineAttendance"

const ATTENDANCE_TONE = { PRESENT: "green", LATE: "yellow", ABSENT: "pink", LEAVE: "yellow" }
const LEAVE_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink", CANCELLED: "slate" }
const LEAVE_TYPE_LABELS = { SICK: "Sick", CASUAL: "Casual / Annual", UNPAID: "Unpaid" }

function fmt(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}
function fmtTime(dateStr, timezone) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleTimeString([], { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

export default function MyAttendance() {
  const queryClient = useQueryClient()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [pendingCount, setPendingCount] = useState(() => getOfflineAttendanceQueue().length)
  const [offlineVerification, setOfflineVerification] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState("")
  const [flagNotice, setFlagNotice] = useState(null)
  const [leaveForm, setLeaveForm] = useState({ startDate: "", endDate: "", reason: "", type: "CASUAL" })
  const [leaveError, setLeaveError] = useState("")

  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ["attendance-self"],
    queryFn: () => api.get("/attendance/self").then((r) => r.data),
    retry: online ? 1 : false,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ["attendance-assigned-sites"],
    queryFn: () => api.get("/attendance-sites/assigned").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })
  const { data: leaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ["leaves-self"],
    queryFn: () => api.get("/leaves").then((r) => r.data),
  })
  const { data: balance } = useQuery({
    queryKey: ["leave-balance"],
    queryFn: () => api.get("/leaves/balance").then((r) => r.data),
  })

  const primarySite = useMemo(() => sites.find((s) => s.isPrimary) || sites[0] || null, [sites])

  async function syncQueue() {
    if (!navigator.onLine) return
    try {
      const result = await syncOfflineAttendanceQueue(api)
      setPendingCount(getOfflineAttendanceQueue().length)
      if (result.synced || result.duplicates) {
        queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
      }
    } catch {
      setPendingCount(getOfflineAttendanceQueue().length)
    }
  }

  useEffect(() => {
    const onlineHandler = () => {
      setOnline(true)
      syncQueue()
    }
    const offlineHandler = () => setOnline(false)
    window.addEventListener("online", onlineHandler)
    window.addEventListener("offline", offlineHandler)
    const timer = setInterval(syncQueue, 15000)
    syncQueue()
    return () => {
      window.removeEventListener("online", onlineHandler)
      window.removeEventListener("offline", offlineHandler)
      clearInterval(timer)
    }
  }, [])

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation is not supported"))
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      })
    })
  }

  async function handleMark(type) {
    setLocationError("")
    setFlagNotice(null)
    setLocating(true)

    let position = null
    try {
      position = await getPosition()
    } catch (err) {
      setLocating(false)
      setLocationError(
        err?.code === 1
          ? "Location permission was denied. Allow location access and try again."
          : "We could not get your location. Try again with location services enabled."
      )
      return
    }
    setLocating(false)

    const now = new Date()
    const timezone = attendance?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now)
    const site = primarySite

    const event = {
      type,
      localRecordedAt: now.toISOString(),
      localDate,
      timezone,
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      gpsAccuracy: position.coords.accuracy,
      distanceMeters: null,
      siteId: site?.id || null,
      siteName: site?.name || "Unassigned / no site",
      deviceId: getAttendanceDeviceId(),
      networkType: navigator.connection?.effectiveType || (navigator.onLine ? "online" : "offline"),
    }

    // If online, use the existing server endpoint first. If it fails because the
    // connection disappears, immediately queue the same event locally.
    if (navigator.onLine) {
      try {
        if (type === "CHECK_IN") {
          const response = await api.post("/attendance/self/mark", {
            status: "PRESENT",
            latitude: event.latitude,
            longitude: event.longitude,
          })
          if (response.data?.autoFlagged) {
            setFlagNotice("Your location was outside the configured office geofence and the server flagged the attendance for review.")
          }
        } else {
          // Checkout is intentionally queued through the offline-safe endpoint.
          // This preserves the exact recorded timestamp rather than using server receipt time.
          await api.post("/attendance/self/offline-sync", { events: [event] })
        }
        queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
        return
      } catch {
        // Continue to local queue.
      }
    }

    const queued = queueOfflineAttendance(event)
    setPendingCount(getOfflineAttendanceQueue().length)
    setOfflineVerification({
      ...queued,
      employeeName: "Current employee",
      timezone,
      siteName: site?.name || "Unassigned / no site",
      status: type === "CHECK_IN" ? "PRESENT" : "PENDING",
    })
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
      <PageHeader title="My Attendance" subtitle="Offline-first attendance for office, field and remote work." backTo="/" />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${online ? "bg-chip-green-bg text-chip-green-fg" : "bg-chip-yellow-bg text-chip-yellow-fg"}`}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? "Online" : "Offline mode"}
        </span>
        {pendingCount > 0 && (
          <button onClick={syncQueue} className="inline-flex items-center gap-1.5 rounded-full bg-chip-yellow-bg px-3 py-1.5 text-xs font-semibold text-chip-yellow-fg">
            <RefreshCw size={13} /> {pendingCount} attendance event{pendingCount > 1 ? "s" : ""} pending sync
          </button>
        )}
      </div>

      {offlineVerification && (
        <OfflineAttendanceVerification record={offlineVerification} site={primarySite} />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-6">
          <SectionHeader title="Today" />
          {loadingAttendance ? <p className="text-sm text-muted">Loading…</p> : isOnLeaveToday ? (
            <div className="flex items-center gap-3 rounded-2xl bg-chip-yellow-bg px-4 py-3">
              <Palmtree size={18} className="text-chip-yellow-fg" />
              <p className="text-sm font-semibold text-chip-yellow-fg">You're on approved leave today.</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">
                Current status: {todayStatus ? <StatusPill tone={ATTENDANCE_TONE[todayStatus] || "slate"}>{todayStatus}</StatusPill> : <span className="font-medium text-muted-2">Not marked yet</span>}
              </p>
              {attendance?.today?.checkInAt && (
                <p className="mb-1 text-sm text-muted">Check in: <strong>{fmtTime(attendance.today.checkInAt, attendance?.timezone)}</strong></p>
              )}
              {attendance?.today?.checkOutAt && (
                <p className="mb-3 text-sm text-muted">Check out: <strong>{fmtTime(attendance.today.checkOutAt, attendance?.timezone)}</strong></p>
              )}

              {primarySite && (
                <div className="mb-4 rounded-2xl bg-surface-2 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Assigned site</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink"><MapPin size={14} /> {primarySite.name}</p>
                  <p className="mt-1 text-xs text-muted">{primarySite.radiusMeters}m geofence · {primarySite.geofenceMode}</p>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => handleMark("CHECK_IN")}
                  disabled={locating || !!attendance?.today?.checkInAt}
                  className="pill-accent flex items-center justify-center gap-1.5 px-4 py-3 text-sm disabled:opacity-50"
                >
                  <CheckCircle2 size={16} /> {locating ? "Getting location…" : "Check In"}
                </button>
                <button
                  onClick={() => handleMark("CHECK_OUT")}
                  disabled={locating || !attendance?.today?.checkInAt || !!attendance?.today?.checkOutAt}
                  className="pill-secondary flex items-center justify-center gap-1.5 px-4 py-3 text-sm disabled:opacity-50"
                >
                  <XCircle size={16} /> Check Out
                </button>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-2">
                <MapPin size={12} className="mt-0.5 shrink-0" />
                GPS is captured even without internet. If the connection drops, the attendance event is stored on this device and synchronized automatically later.
              </p>

              {locationError && <div className="mt-3 rounded-2xl bg-chip-pink-bg px-3 py-2.5 text-xs font-medium text-chip-pink-fg">{locationError}</div>}
              {flagNotice && <div className="mt-3 flex items-start gap-2 rounded-2xl bg-chip-yellow-bg px-3 py-2.5 text-xs text-chip-yellow-fg"><AlertTriangle size={14} />{flagNotice}</div>}
            </>
          )}

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Last 30 days</p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {(attendance?.history || []).map((r) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted">{fmt(r.date)}</span>
                  <StatusPill tone={ATTENDANCE_TONE[r.status] || "slate"}>{r.status}</StatusPill>
                </li>
              ))}
              {(attendance?.history || []).length === 0 && <li className="text-sm text-muted">No attendance recorded yet.</li>}
            </ul>
          </div>
        </div>

        <div className="card p-6">
          <SectionHeader title="Request Leave" />
          <form onSubmit={handleLeaveSubmit} className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" value={leaveForm.type} onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))} className="sm:col-span-2">
              {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectField>
            <TextField label="From" type="date" value={leaveForm.startDate} onChange={(e) => setLeaveForm((f) => ({ ...f, startDate: e.target.value }))} required />
            <TextField label="To" type="date" value={leaveForm.endDate} onChange={(e) => setLeaveForm((f) => ({ ...f, endDate: e.target.value }))} required />
            <TextAreaField label="Reason" value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} className="sm:col-span-2" required />
            {leaveError && <div className="sm:col-span-2 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{leaveError}</div>}
            <div className="sm:col-span-2">
              <button type="submit" disabled={submitLeave.isPending} className="pill-accent flex items-center gap-1.5 px-5 py-2.5 text-sm disabled:opacity-60">
                <Send size={14} /> {submitLeave.isPending ? "Submitting…" : "Submit Application"}
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
                    <p className="text-sm font-semibold text-ink">{fmt(leave.startDate)} — {fmt(leave.endDate)}</p>
                    <div className="flex items-center gap-1.5">
                      <StatusPill tone="slate">{LEAVE_TYPE_LABELS[leave.type] || leave.type}</StatusPill>
                      <StatusPill tone={LEAVE_TONE[leave.status] || "slate"}>{leave.status}</StatusPill>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">{leave.reason}</p>
                  {leave.status === "PENDING" && <button onClick={() => cancelLeave.mutate(leave.id)} disabled={cancelLeave.isPending} className="mt-2 flex items-center gap-1 text-xs font-semibold text-danger hover:underline"><Ban size={12} /> Cancel request</button>}
                  {leave.reviewNote && <p className="mt-1.5 text-xs italic text-muted-2">Note: {leave.reviewNote}</p>}
                </li>
              ))}
              {(leaves || []).length === 0 && !loadingLeaves && <EmptyState title="No leave applications yet" description="Submit one using the form above." />}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
