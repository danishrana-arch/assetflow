import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, XCircle, Palmtree, Send, Ban, MapPin, Wifi, WifiOff, RefreshCw } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import StatusPill from "../components/ui/StatusPill"
import { TextField, TextAreaField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"
import OfflineAttendanceVerification from "../components/OfflineAttendanceVerification"
import { nearestAssignedSite } from "../utils/siteGeofence"
import {
  getAttendanceDeviceId,
  getOfflineAttendanceQueue,
  queueOfflineAttendance,
  syncOfflineAttendanceQueue,
  cacheAttendanceSnapshot,
  readCachedAttendanceSnapshot,
  cacheAssignedSites,
  readCachedAssignedSites,
} from "../utils/offlineAttendance"

const ATTENDANCE_TONE = { PRESENT: "green", LATE: "yellow", ABSENT: "pink", LEAVE: "yellow" }
const LEAVE_TONE = { PENDING_HR: "yellow", PENDING_FINAL_APPROVAL: "blue", APPROVED: "green", REJECTED: "pink", CANCELLED: "slate" }
const LEAVE_STATUS_LABELS = { PENDING_HR: "Waiting for HR", PENDING_FINAL_APPROVAL: "HR approved · waiting for Admin/CEO", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" }
const LEAVE_TYPE_LABELS = { ANNUAL: "Annual", CASUAL: "Casual", SICK: "Sick", UNPAID: "Unpaid" }
const LEAVE_BUCKET = { ANNUAL: "annual", CASUAL: "casual", SICK: "sick" }
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const fmtLeaveDays = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} day${Number(n) === 1 ? "" : "s"}`

function fmt(dateStr) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}
function fmtTime(dateStr, timezone) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleTimeString("en-US", { timeZone: timezone || undefined, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })
}

// "YYYY-MM-DD" + "HH:mm" as wall-clock time in `timeZone` → ISO instant, so
// a correction means the org's local time whatever the browser's zone is.
function zonedToIso(dayKey, hhmm, timeZone) {
  const [y, mo, d] = dayKey.split("-").map(Number)
  const [h, mi] = hhmm.split(":").map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(guess)).map((p) => [p.type, p.value])
    )
    const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
    return new Date(guess - (asLocal - guess)).toISOString()
  } catch {
    return new Date(`${dayKey}T${hhmm}`).toISOString()
  }
}
function timeIn(value, timeZone) {
  if (!value) return ""
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value))
  } catch { return "" }
}

const CORRECTION_TONE = { PENDING: "yellow", APPROVED: "green", REJECTED: "pink" }

// Ask HR to fix a day's check-in/check-out (forgot to check out, phone died,
// wrong time). HR approves it on the Attendance page, which updates this
// same record.
function CorrectionRequest({ record, timeZone, latest }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ checkIn: "", checkOut: "", reason: "" })
  const [error, setError] = useState("")
  const dayKey = String(record.date).slice(0, 10)
  const send = useMutation({
    mutationFn: () => api.post("/attendance/self/corrections", {
      attendanceId: record.id,
      requestedCheckInAt: form.checkIn && form.checkIn !== timeIn(record.checkInAt, timeZone) ? zonedToIso(dayKey, form.checkIn, timeZone) : null,
      requestedCheckOutAt: form.checkOut && form.checkOut !== timeIn(record.checkOutAt, timeZone) ? zonedToIso(dayKey, form.checkOut, timeZone) : null,
      reason: form.reason,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["attendance-self-corrections"] }); setOpen(false) },
    onError: (e) => setError(e.response?.data?.error || "Could not send the request."),
  })
  const start = () => {
    setForm({ checkIn: timeIn(record.checkInAt, timeZone), checkOut: timeIn(record.checkOutAt, timeZone), reason: "" })
    setError(""); setOpen(true)
  }
  function submit(e) {
    e.preventDefault()
    if (!form.checkIn && !form.checkOut) return setError("Enter the correct check-in and/or check-out time.")
    if (form.checkIn && form.checkOut && form.checkOut <= form.checkIn) return setError("Check-out must be after check-in.")
    if (!form.reason.trim()) return setError("Add a short reason for HR.")
    // Only send the times that actually change.
    const unchangedIn = form.checkIn === timeIn(record.checkInAt, timeZone)
    const unchangedOut = form.checkOut === timeIn(record.checkOutAt, timeZone)
    if (unchangedIn && unchangedOut) return setError("Change at least one time.")
    send.mutate()
  }

  if (!open) {
    return (
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-2">
          {latest && (
            <>
              Correction <StatusPill tone={CORRECTION_TONE[latest.status] || "slate"}>{latest.status === "PENDING" ? "Waiting for HR" : latest.status.toLowerCase()}</StatusPill>
              {latest.reviewNote && <span className="ml-1">· {latest.reviewNote}</span>}
            </>
          )}
        </span>
        {latest?.status !== "PENDING" && (
          <button type="button" onClick={start} className="shrink-0 font-semibold text-accent hover:underline">Request time correction</button>
        )}
      </div>
    )
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-2xl bg-surface-2 p-3">
      <p className="text-[11px] font-semibold text-muted">Correct times for {fmt(record.date)} — HR reviews this before it changes your record.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted">Check-in
          <input type="time" className="field mt-1 py-1.5 text-xs" value={form.checkIn} onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value }))} />
        </label>
        <label className="text-[11px] text-muted">Check-out
          <input type="time" className="field mt-1 py-1.5 text-xs" value={form.checkOut} onChange={(e) => setForm((f) => ({ ...f, checkOut: e.target.value }))} />
        </label>
      </div>
      <textarea className="field w-full text-xs" rows="2" maxLength={1000} placeholder="e.g. Forgot to check out, left at 6:10 PM" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
      {error && <p className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-3 py-1.5 text-xs text-muted hover:bg-surface-3">Cancel</button>
        <button disabled={send.isPending} className="pill-accent px-3 py-1.5 text-xs disabled:opacity-50">{send.isPending ? "Sending…" : "Send to HR"}</button>
      </div>
    </form>
  )
}

export default function MyAttendance() {
  const queryClient = useQueryClient()
  const { user, organization } = useAuth()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [offlineToday, setOfflineToday] = useState({ checkInAt: null, checkOutAt: null, status: null })
  const [offlineVerification, setOfflineVerification] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState("")
  const [leaveForm, setLeaveForm] = useState({ startDate: "", endDate: "", reason: "", type: "ANNUAL" })
  const [leaveError, setLeaveError] = useState("")
  const [locationMode, setLocationMode] = useState("OFFICE")
  // Check-in progress fill: animates toward 90% while the geofence check +
  // API call run, snaps to 100% on response, resets on error.
  const [checkInFill, setCheckInFill] = useState(0)
  const [checkInFillDuration, setCheckInFillDuration] = useState(4)

  // The device copy is only a placeholder (shown while loading or offline),
  // never treated as current data — so every visit/refresh fetches fresh
  // attendance, and the copy is per user. Keys include the user id so one
  // person's data can't be served to the next login in the same tab.
  const { data: attendance, isLoading: loadingAttendance } = useQuery({
    queryKey: ["attendance-self", user?.id],
    queryFn: () => api.get("/attendance/self").then((r) => {
      cacheAttendanceSnapshot(r.data)
      return r.data
    }),
    placeholderData: readCachedAttendanceSnapshot,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !!user?.id,
    retry: online ? 1 : false,
  })
  const { data: sites = [] } = useQuery({
    queryKey: ["attendance-assigned-sites", user?.id],
    queryFn: () => api.get("/attendance-sites/assigned").then((r) => {
      cacheAssignedSites(r.data)
      return r.data
    }),
    placeholderData: readCachedAssignedSites,
    staleTime: 0,
    refetchOnMount: "always",
    enabled: !!user?.id,
    retry: 1,
  })
  const { data: leaves, isLoading: loadingLeaves } = useQuery({
    queryKey: ["leaves-self", user?.id],
    // mine=1: own applications even for roles that review leave.
    queryFn: () => api.get("/leaves", { params: { mine: 1 } }).then((r) => r.data),
    enabled: !!user?.id,
  })
  const { data: balance } = useQuery({
    queryKey: ["leave-balance", "self", user?.id],
    queryFn: () => api.get("/leaves/balance").then((r) => r.data),
    enabled: !!user?.id,
  })
  const { data: myCorrections = [] } = useQuery({
    queryKey: ["attendance-self-corrections", user?.id],
    queryFn: () => api.get("/attendance/self/corrections").then((r) => r.data),
    enabled: online,
    retry: false,
  })
  // Newest request per attendance record (list is newest first).
  const correctionByRecord = useMemo(() => {
    const map = new Map()
    for (const c of myCorrections) if (c.attendanceId && !map.has(c.attendanceId)) map.set(c.attendanceId, c)
    return map
  }, [myCorrections])

  const primarySite = useMemo(() => sites.find((s) => s.isPrimary) || sites[0] || null, [sites])
  const activeSite = primarySite
  // Assigned to a site (directly or via its project): check-in only from
  // inside the site, no work-from-home option.
  const siteBound = sites.length > 0
  const effectiveCheckInAt = attendance?.today?.checkInAt || offlineToday.checkInAt
  const effectiveCheckOutAt = attendance?.today?.checkOutAt || offlineToday.checkOutAt
  // Today's date (YYYY-MM-DD) in the organization's timezone.
  const historyToday = new Intl.DateTimeFormat("en-CA", { timeZone: attendance?.timezone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const todayStatus = attendance?.today?.status || offlineToday.status
  const isOnLeaveToday = todayStatus === "LEAVE"
  // Once today's attendance is on record, the day's mode is whatever was
  // used at check-in — the selector below only matters before that.
  const effectiveLocationMode = attendance?.today?.locationMode || (siteBound ? "OFFICE" : locationMode)

  function nearestSite(latitude, longitude) {
    return nearestAssignedSite(sites, latitude, longitude)
  }

  async function refreshOfflineQueueState() {
    const queue = await getOfflineAttendanceQueue()
    setPendingCount(queue.length)
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: attendance?.timezone || organization?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    }).format(new Date())
    const todayEvents = queue
      .filter((event) => event.localDate === today)
      .sort((a, b) => new Date(a.localRecordedAt) - new Date(b.localRecordedAt))
    const checkIn = [...todayEvents].reverse().find((event) => event.type === "CHECK_IN")
    const checkOut = [...todayEvents].reverse().find((event) => event.type === "CHECK_OUT")
    setOfflineToday({
      checkInAt: checkIn ? checkIn.localRecordedAt : null,
      checkOutAt: checkOut?.localRecordedAt || null,
      status: checkIn ? (checkIn.outsideSite ? "LATE" : "PRESENT") : null,
    })
    return queue
  }

  async function syncQueue() {
    if (!navigator.onLine) {
      await refreshOfflineQueueState()
      return
    }
    try {
      const result = await syncOfflineAttendanceQueue(api)
      await refreshOfflineQueueState()
      if (result.synced || result.duplicates) {
        queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
      }
    } catch {
      await refreshOfflineQueueState()
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

  function startCheckInFill() {
    setCheckInFillDuration(4)
    setCheckInFill(0)
    // Two rAFs so the browser commits 0% before animating to 90% — a plain
    // synchronous 0 -> 90 wouldn't transition, it'd just render at 90%.
    requestAnimationFrame(() => requestAnimationFrame(() => setCheckInFill(90)))
  }
  function finishCheckInFill() {
    setCheckInFillDuration(0.25)
    setCheckInFill(100)
  }
  function resetCheckInFill() {
    setCheckInFillDuration(0.25)
    setCheckInFill(0)
  }

  async function handleMark(type) {
    setLocationError("")
    const isWfh = type === "CHECK_IN" && effectiveLocationMode === "WFH"
    if (type === "CHECK_IN") startCheckInFill()

    const now = new Date()
    const timezone = attendance?.timezone || organization?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now)

    let position = null
    let nearest = null
    let site = null
    let outsideSite = false
    if (!isWfh) {
      setLocating(true)
      try {
        position = await getPosition()
      } catch (err) {
        setLocating(false)
        resetCheckInFill()
        setLocationError(
          err?.code === 1
            ? "Location permission was denied. Allow location access and try again."
            : "We could not get your location. Try again with location services enabled."
        )
        return
      }
      setLocating(false)

      nearest = nearestSite(position.coords.latitude, position.coords.longitude)
      site = nearest?.site || primarySite
      const inside = nearest?.inside ?? false
      // A check-in from outside the assigned site still goes through — the
      // server records it as LATE (flagged for HR review) with the location.
      outsideSite = type === "CHECK_IN" && siteBound && !inside && !sites.some((s) => s.geofenceMode === "DISABLED")
      if (type === "CHECK_OUT" && site && site.geofenceMode === "STRICT" && !inside) {
        resetCheckInFill()
        setLocationError(site?.boundary?.length >= 3
          ? `You are outside the assigned site boundary. Move inside the marked project area and try again.`
          : `You are outside your assigned site geofence. ${Math.round(nearest?.distance || 0)}m from the site center; allowed radius is ${site.radiusMeters}m.`)
        return
      }
    }

    const event = {
      type,
      localRecordedAt: now.toISOString(),
      localDate,
      timezone,
      locationMode: effectiveLocationMode,
      latitude: position?.coords.latitude ?? null,
      longitude: position?.coords.longitude ?? null,
      gpsAccuracy: position?.coords.accuracy ?? null,
      distanceMeters: nearest?.distance != null ? Math.round(nearest.distance) : null,
      siteId: site?.id || null,
      siteName: isWfh ? "Work from home" : (site?.name || "Unassigned / no site"),
      outsideSite,
      deviceId: getAttendanceDeviceId(),
      networkType: navigator.connection?.effectiveType || (navigator.onLine ? "online" : "offline"),
      clientEventId: `att-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`,
    }

    // If online, use the existing server endpoint first. If it fails because the
    // connection disappears, immediately queue the same event locally.
    if (navigator.onLine) {
      try {
        if (type === "CHECK_IN") {
          const { data } = await api.post("/attendance/self/mark", {
            status: "PRESENT",
            latitude: event.latitude,
            longitude: event.longitude,
            gpsAccuracy: event.gpsAccuracy,
            siteId: event.siteId,
            locationMode: event.locationMode,
            clientEventId: event.clientEventId,
          })
          // Accepted either way; an outside-premises check-in is recorded as
          // Late and flagged for HR, so tell the employee why.
          finishCheckInFill()
          if (data?.outsideSite) {
            setLocationError(data.message || "You checked in outside the office premises. Your attendance was recorded as Late with your location; HR will review it.")
          }
        } else {
          // Checkout is intentionally queued through the offline-safe endpoint.
          // This preserves the exact recorded timestamp rather than using server receipt time.
          await api.post("/attendance/self/offline-sync", { events: [event] })
        }
        queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
        return
      } catch (err) {
        if (type === "CHECK_IN") resetCheckInFill()
        // A geofence rejection (403) is a deliberate "not marked" outcome, not
        // a connectivity failure — queuing it offline would just fail again
        // the same way once it syncs. Show the reason and stop; anything
        // else (network drop, server unreachable) still falls through to
        // the offline queue below.
        if (err?.response?.status === 403) {
          setLocationError(err.response?.data?.error || "You are outside the allowed location. Attendance was not marked.")
          return
        }
      }
    } else if (type === "CHECK_IN") {
      resetCheckInFill()
    }

    const queued = await queueOfflineAttendance(event)
    await refreshOfflineQueueState()
    setOfflineVerification({
      ...queued,
      employeeName: user?.name || "Current employee",
      timezone,
      siteName: event.siteName,
      status: type === "CHECK_IN" ? (outsideSite ? "LATE" : "PRESENT") : "PENDING",
    })
    if (outsideSite) setLocationError("You are outside your assigned site. This check-in will be recorded as Late with your location once it syncs; HR will review it.")
  }

  const submitLeave = useMutation({
    mutationFn: () => api.post("/leaves", leaveForm),
    onSuccess: () => {
      setLeaveForm({ startDate: "", endDate: "", reason: "", type: "ANNUAL" })
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
        <OfflineAttendanceVerification record={offlineVerification} site={activeSite} />
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
              {effectiveCheckInAt && (
                <p className="mb-1 text-sm text-muted">Check in: <strong>{fmtTime(effectiveCheckInAt, attendance?.timezone)}</strong>{!attendance?.today?.checkInAt && <span className="ml-2 text-[10px] text-chip-yellow-fg">offline</span>}</p>
              )}
              {effectiveCheckOutAt && (
                <p className="mb-3 text-sm text-muted">Check out: <strong>{fmtTime(effectiveCheckOutAt, attendance?.timezone)}</strong>{!attendance?.today?.checkOutAt && <span className="ml-2 text-[10px] text-chip-yellow-fg">offline</span>}{attendance?.today?.autoCheckedOut && <span className="ml-2 text-[10px] text-muted-2">recorded automatically at shift end</span>}</p>
              )}

              {activeSite && effectiveLocationMode !== "WFH" && (
                <div className="mb-4 rounded-2xl bg-surface-2 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Assigned site</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink"><MapPin size={14} /> {activeSite.name}</p>
                  <p className="mt-1 text-xs text-muted">{activeSite.boundary?.length >= 3 ? "Custom project boundary" : `${activeSite.radiusMeters}m radius`} · {activeSite.geofenceMode}{activeSite.projectName ? ` · ${activeSite.projectName}` : ""} · {activeSite.outsideGraceMinutes || 60} min outside grace</p>
                </div>
              )}

              {!effectiveCheckInAt && siteBound && (
                <p className="mb-4 rounded-2xl bg-chip-yellow-bg px-3 py-2.5 text-xs font-medium text-chip-yellow-fg">
                  You are assigned to {sites.length > 1 ? "project sites" : `"${activeSite?.name}"`}. Attendance can only be marked from inside the site — work from home is not available. Checking in from outside is recorded as Late with your location, for HR to review.
                </p>
              )}

              {!effectiveCheckInAt && !siteBound && (
                <div className="mb-4">
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Today's mode</p>
                  <div className="flex gap-1.5">
                    {[
                      { value: "OFFICE", label: "Office / Site" },
                      { value: "WFH", label: "Work from home" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setLocationMode(opt.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                          locationMode === opt.value ? "bg-accent text-on-accent" : "bg-surface-2 text-muted hover:text-ink"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {locationMode === "WFH" && <p className="mt-1.5 text-[11px] text-muted-2">No location will be requested for a work-from-home check-in.</p>}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => handleMark("CHECK_IN")}
                  disabled={locating || !!effectiveCheckInAt}
                  className="pill-accent relative flex items-center justify-center gap-1.5 overflow-hidden px-4 py-3 text-sm disabled:opacity-50"
                >
                  <span
                    className="absolute inset-y-0 left-0 bg-white/25"
                    style={{ width: `${checkInFill}%`, transition: `width ${checkInFillDuration}s ${checkInFill >= 100 ? "ease-out" : "linear"}` }}
                  />
                  <span className="relative flex items-center gap-1.5">
                    <CheckCircle2 size={16} /> {locating ? "Getting location…" : "Check In"}
                  </span>
                </button>
                <button
                  onClick={() => handleMark("CHECK_OUT")}
                  disabled={locating || !effectiveCheckInAt || !!effectiveCheckOutAt}
                  className="pill-secondary flex items-center justify-center gap-1.5 px-4 py-3 text-sm disabled:opacity-50"
                >
                  <XCircle size={16} /> Check Out
                </button>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-muted-2">
                <MapPin size={12} className="mt-0.5 shrink-0" />
                {effectiveLocationMode === "WFH"
                  ? "Work-from-home check-ins don't require location."
                  : "GPS is captured even without internet. If the connection drops, the attendance event is stored on this device and synchronized automatically later."}
              </p>

              {locationError && <div className="mt-3 rounded-2xl bg-chip-pink-bg px-3 py-2.5 text-xs font-medium text-chip-pink-fg">{locationError}</div>}
            </>
          )}

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Last 30 days</p>
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {(attendance?.history || []).map((r) => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">{fmt(r.date)}{r.autoCheckedOut && <span className="ml-2 text-[10px] text-muted-2">auto check-out</span>}</span>
                    <StatusPill tone={ATTENDANCE_TONE[r.status] || "slate"}>{r.status}</StatusPill>
                  </div>
                  {online && r.id && r.status !== "LEAVE" && String(r.date).slice(0, 10) <= historyToday && (
                    <CorrectionRequest record={r} timeZone={attendance?.timezone || organization?.timezone} latest={correctionByRecord.get(r.id)} />
                  )}
                </li>
              ))}
              {(attendance?.history || []).length === 0 && <li className="text-sm text-muted">No attendance recorded yet.</li>}
            </ul>
          </div>
        </div>

        <div className="card p-6">
          <SectionHeader title="Request Leave" />
          {balance?.schedule && !balance.schedule.eligible ? (
            <div className="rounded-2xl bg-chip-yellow-bg px-4 py-3 text-sm text-chip-yellow-fg">
              <p className="font-semibold">{balance.schedule.message}</p>
              <p className="mt-1 text-xs">Your leave history and balance stay available below. HR updates your employment status.</p>
            </div>
          ) : (
          <>
          {balance?.schedule?.currentMonth && (() => {
            const sch = balance.schedule
            const cm = sch.currentMonth
            const joinedThisYear = sch.accrualStartMonth && sch.accrualStartMonth > 1
            return (
              <div className="mb-4 space-y-3 rounded-2xl bg-surface-2 px-4 py-3 text-xs text-muted">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Earned by end of {cm.name}</p>
                    <p className="mt-0.5 text-lg font-semibold text-ink">{fmtLeaveDays(cm.accrued)}</p>
                    <p className="text-muted-2">of {fmtLeaveDays(sch.yearEntitlement)} this year</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Requested / approved</p>
                    <p className="mt-0.5 text-lg font-semibold text-ink">{fmtLeaveDays(cm.used)}</p>
                    <p className="text-muted-2">paid leave in {sch.year}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Available now</p>
                    <p className="mt-0.5 text-lg font-semibold text-chip-green-fg">{fmtLeaveDays(cm.remaining)}</p>
                    <p className="text-muted-2">{fmtLeaveDays(sch.remainingThisYear)} left for the whole year</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["ANNUAL", "CASUAL", "SICK"].map((t) => {
                    const b = balance[LEAVE_BUCKET[t]]
                    if (!b) return null
                    return (
                      <span key={t} className="rounded-full border border-border bg-surface px-3 py-1">
                        <span className="font-semibold text-ink">{LEAVE_TYPE_LABELS[t]}</span> {b.remaining} of {b.total} left
                        {b.pending > 0 ? <span className="text-muted-2"> · {b.pending} pending</span> : null}
                      </span>
                    )
                  })}
                </div>
                <div className="grid grid-cols-6 gap-1 sm:grid-cols-12">
                  {sch.months.map((m) => {
                    const isNow = m.month === cm.month
                    const before = !m.accrued
                    return (
                      <div
                        key={m.month}
                        title={`${m.name}: ${m.accrued} earned, ${m.cumulative} used by then`}
                        className={`rounded-lg px-1 py-1 text-center ${isNow ? "bg-accent text-on-accent" : before ? "bg-surface text-muted-2 opacity-60" : "bg-surface text-ink"}`}
                      >
                        <div className="text-[10px] font-semibold">{SHORT_MONTHS[m.month - 1]}</div>
                        <div className="font-mono text-[11px]">{m.accrued}</div>
                      </div>
                    )
                  })}
                </div>
                <p className="text-muted-2">
                  Pro-rata leave: you earn {sch.monthlyRate} days of paid leave every month ({sch.entitlement} a year, shared by annual, casual and sick leave)
                  {joinedThisYear ? `, counted from ${SHORT_MONTHS[sch.accrualStartMonth - 1]} ${sch.year} when you joined` : ""}.
                  You can only use what you've earned by the month of the leave. Unpaid leave doesn't use your balance. Resets every January.
                  Requests go to HR, then to an Admin or CEO.
                </p>
              </div>
            )
          })()}
          <form onSubmit={handleLeaveSubmit} className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" value={leaveForm.type} onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))} className="sm:col-span-2">
              {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => {
                const b = balance?.[LEAVE_BUCKET[v]]
                return <option key={v} value={v}>{l}{b ? ` — ${b.remaining} of ${b.total} left` : v === "UNPAID" ? " — doesn't use your balance (deducted from pay)" : ""}</option>
              })}
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
          </>
          )}

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
                      <StatusPill tone={LEAVE_TONE[leave.status] || "slate"}>{LEAVE_STATUS_LABELS[leave.status] || leave.status}</StatusPill>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">{leave.reason}</p>
                  {(leave.status === "PENDING_HR" || leave.status === "PENDING_FINAL_APPROVAL") && <button onClick={() => cancelLeave.mutate(leave.id)} disabled={cancelLeave.isPending} className="mt-2 flex items-center gap-1 text-xs font-semibold text-danger hover:underline"><Ban size={12} /> Cancel request</button>}
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
