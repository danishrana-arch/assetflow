import { useCallback, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  LogIn, LogOut, UserX, Search, X, Wifi, WifiOff, RefreshCw, MapPin, Building2, FolderKanban, Clock,
  History, ClipboardList, AlertTriangle, CheckCircle2, Pencil, Users, Navigation,
} from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"
import { formatTime } from "../utils/time"
import { DateRangeInput } from "../components/ui/DatePicker"
import {
  getAttendanceDeviceId,
  getSiteAdminQueue,
  queueSiteAdminAction,
  syncSiteAdminQueue,
  readSiteAdminRejections,
  clearSiteAdminRejections,
  cacheSiteAdminData,
  readCachedSiteAdminData,
} from "../utils/offlineAttendance"

// Site Admin / Project Manager workspace: mark check-in, check-out or absent
// for workers at the sites assigned to you (workers without a phone). Works
// offline: actions are queued on this device and synced automatically when
// the connection returns; the server re-checks every action and ignores a
// duplicate. Built for phones and tablets.

const SITE_KEY = "assetflow_site_admin_site"

function newEventId() {
  if (globalThis.crypto?.randomUUID) return `sa-${globalThis.crypto.randomUUID()}`
  return `sa-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readSavedSite() {
  try { return localStorage.getItem(SITE_KEY) || "" } catch { return "" }
}

// Best-effort device location for the site geofence check.
function currentPosition(timeout = 8000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, gpsAccuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 }
    )
  })
}

function isNetworkError(err) {
  return !err?.response
}

// Fetches from the API, falling back to the last copy saved on this device
// when offline (so the roster stays usable at a site with no signal).
async function cachedGet(path, cacheKey, params) {
  try {
    const { data } = await api.get(path, { params })
    cacheSiteAdminData(cacheKey, data)
    return { ...data, fromCache: false }
  } catch (err) {
    const cached = readCachedSiteAdminData(cacheKey)
    if (isNetworkError(err) && cached) return { ...cached, fromCache: true }
    throw err
  }
}

const STATE_INFO = {
  NOT_CHECKED_IN: { label: "Not checked in", tone: "slate" },
  MARKED: { label: "Marked present", tone: "green" },
  CHECKED_IN: { label: "Checked in", tone: "green" },
  CHECKED_OUT: { label: "Checked out", tone: "blue" },
  ABSENT: { label: "Absent", tone: "pink" },
  LEAVE: { label: "On leave", tone: "yellow" },
}

const ACTION_LABEL = { CHECK_IN: "Check in", CHECK_OUT: "Check out", MARK_ABSENT: "Absent" }

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off) }
  }, [])
  return online
}

function dayLabel(key, todayKey) {
  if (key === todayKey) return "Today"
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${key}T00:00:00Z`))
}

// Correction request on a worker's behalf — reviewed by HR/Admin on the
// Attendance page (the Site Admin can't rewrite attendance directly).
function CorrectionModal({ employee, site, date, timeZone, onClose, onSent }) {
  const [checkIn, setCheckIn] = useState(() => (employee.record?.checkInAt ? toLocalInput(employee.record.checkInAt, timeZone) : ""))
  const [checkOut, setCheckOut] = useState(() => (employee.record?.checkOutAt ? toLocalInput(employee.record.checkOutAt, timeZone) : ""))
  const [reason, setReason] = useState("")
  const send = useMutation({
    mutationFn: () => api.post("/site-admin/corrections", {
      siteId: site.id,
      employeeId: employee.id,
      date,
      requestedCheckInAt: checkIn ? localInputToIso(date, checkIn, timeZone) : null,
      requestedCheckOutAt: checkOut ? localInputToIso(date, checkOut, timeZone) : null,
      reason,
    }).then((r) => r.data),
    onSuccess: () => { onSent(); onClose() },
  })
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={(e) => { e.preventDefault(); send.mutate() }}
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-base font-semibold text-ink">Correct attendance</p>
            <p className="mt-0.5 text-xs text-muted">{employee.name} · {site.name} · {dayLabel(date, date)}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Close"><X size={18} /></button>
        </div>
        <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
          This sends a correction request. HR or an Admin approves it on the Attendance page before anything changes.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold text-muted">
            Check-in
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="field mt-1 py-3 text-base" />
          </label>
          <label className="text-xs font-semibold text-muted">
            Check-out
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="field mt-1 py-3 text-base" />
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted-2">Times are in the site's time zone ({timeZone}).</p>
        <label className="mt-3 block text-xs font-semibold text-muted">
          Reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 500))} rows={3} required placeholder="e.g. Marked check-in late — worker arrived at 8:30" className="field mt-1 resize-none text-sm" />
        </label>
        {send.isError && <p className="mt-2 text-xs text-danger">{send.error?.response?.data?.error || "Couldn't send — you need a connection for corrections."}</p>}
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="pill-secondary flex-1 px-4 py-3 text-sm">Cancel</button>
          <button type="submit" disabled={send.isPending || !reason.trim() || (!checkIn && !checkOut)} className="pill-accent flex-1 px-4 py-3 text-sm disabled:opacity-50">
            {send.isPending ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </div>
  )
}

// "HH:MM" in the site's timezone for a stored instant.
function toLocalInput(value, timeZone) {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value))
  } catch {
    return ""
  }
}

// dateKey + "HH:MM" wall time in timeZone → ISO instant.
function localInputToIso(dateKey, hhmm, timeZone) {
  const target = Date.parse(`${dateKey}T${hhmm}:00Z`)
  let guess = target
  for (let i = 0; i < 3; i += 1) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date(guess))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)])
    )
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    guess += target - shown
  }
  return new Date(guess).toISOString()
}

function EmployeeCard({ employee, site, timeZone, pending, busy, onAction, onCorrect }) {
  const queued = pending?.[pending.length - 1]
  const state = queued
    ? queued.action === "CHECK_IN" ? "CHECKED_IN" : queued.action === "CHECK_OUT" ? "CHECKED_OUT" : "ABSENT"
    : employee.state
  const info = STATE_INFO[state] || STATE_INFO.NOT_CHECKED_IN
  const r = employee.record
  const inAt = queued?.action === "CHECK_IN" ? queued.localRecordedAt : r?.checkInAt
  const outAt = queued?.action === "CHECK_OUT" ? queued.localRecordedAt : r?.checkOutAt
  const canCheckIn = !queued && ["NOT_CHECKED_IN", "MARKED", "ABSENT"].includes(employee.state) && !(employee.state === "ABSENT" && r?.checkInAt)
  const canCheckOut = (!queued && employee.state === "CHECKED_IN") || queued?.action === "CHECK_IN"
  const canAbsent = !queued && employee.state === "NOT_CHECKED_IN"

  return (
    <div className="card flex h-full min-w-0 flex-col p-4">
      <div className="flex items-center gap-3">
        <Avatar name={employee.name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{employee.name}</p>
          <p className="truncate text-xs text-muted">
            {employee.projectName ? <><FolderKanban size={11} className="mr-1 inline" />{employee.projectName}</> : employee.designation || employee.department || "Site employee"}
          </p>
        </div>
        <StatusPill tone={info.tone}>{queued ? `${info.label} · waiting` : info.label}</StatusPill>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-2xl bg-surface-2 px-3 py-2">
          <p className="text-muted">Check-in</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{inAt ? formatTime(inAt, { timeZone }) : "--"}</p>
          {employee.atOtherSite && employee.checkInSiteName && <p className="mt-0.5 truncate text-[10px] text-muted-2">at {employee.checkInSiteName}</p>}
        </div>
        <div className="rounded-2xl bg-surface-2 px-3 py-2">
          <p className="text-muted">Check-out</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{outAt ? formatTime(outAt, { timeZone }) : "--"}</p>
          {employee.checkOutSiteName && <p className="mt-0.5 truncate text-[10px] text-muted-2">at {employee.checkOutSiteName}</p>}
        </div>
      </div>

      {(r?.dayType === "HALF_DAY" || r?.dayType === "EARLY_GOING" || r?.status === "LATE" || r?.autoFlagged) && !queued && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.status === "LATE" && <StatusPill tone="yellow">Late{r.lateMinutes ? ` · ${r.lateMinutes} min` : ""}</StatusPill>}
          {r.dayType === "HALF_DAY" && <StatusPill tone="orange">Half day</StatusPill>}
          {r.dayType === "EARLY_GOING" && <StatusPill tone="pink">Early going</StatusPill>}
          {r.autoFlagged && <StatusPill tone="pink" icon={AlertTriangle}>Location flagged</StatusPill>}
        </div>
      )}
      {r?.dayTypeReason && !queued && <p className="mt-1.5 text-[11px] text-muted">{r.dayTypeReason}</p>}
      {queued && <p className="mt-2 text-[11px] font-medium text-chip-yellow-fg">Saved on this device — syncs when you're back online.</p>}
      {employee.markedByName && !queued && <p className="mt-1.5 text-[11px] text-muted-2">Last marked by {employee.markedByName}</p>}
      {employee.pendingCorrection && <p className="mt-1 text-[11px] text-chip-blue-fg">Correction request waiting for HR</p>}

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {canCheckIn && (
          <button type="button" disabled={busy} onClick={() => onAction(employee, "CHECK_IN")} className="pill-accent flex w-full items-center justify-center gap-2 px-4 py-3.5 text-base disabled:opacity-50">
            <LogIn size={18} /> Check In
          </button>
        )}
        {canCheckOut && (
          <button type="button" disabled={busy} onClick={() => onAction(employee, "CHECK_OUT")} className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-3.5 text-base font-semibold text-canvas hover:opacity-90 disabled:opacity-50">
            <LogOut size={18} /> Check Out
          </button>
        )}
        <div className="flex gap-2">
          {canAbsent && (
            <button type="button" disabled={busy} onClick={() => onAction(employee, "MARK_ABSENT")} className="pill-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm text-danger disabled:opacity-50">
              <UserX size={15} /> Mark absent
            </button>
          )}
          {!queued && employee.state !== "LEAVE" && (
            <button type="button" onClick={() => onCorrect(employee)} disabled={employee.pendingCorrection} className="pill-secondary flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm disabled:opacity-50" title={employee.pendingCorrection ? "A correction is already waiting" : "Request a correction"}>
              <Pencil size={14} /> Correct
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function HistoryTab({ todayKey }) {
  const defaultFrom = useMemo(() => {
    const d = new Date(`${todayKey}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 13)
    return d.toISOString().slice(0, 10)
  }, [todayKey])
  const [range, setRange] = useState({ from: defaultFrom, to: todayKey })
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["site-admin-history", range.from, range.to],
    queryFn: () => cachedGet("/site-admin/history", `history:${range.from}:${range.to}`, range),
  })
  const byDate = useMemo(() => {
    const groups = new Map()
    for (const row of data?.rows || []) {
      if (!groups.has(row.date)) groups.set(row.date, [])
      groups.get(row.date).push(row)
    }
    return [...groups.entries()]
  }, [data])

  return (
    <div>
      <div className="card mb-4 grid grid-cols-2 gap-3 p-4 sm:flex sm:items-end">
        <div className="col-span-2 sm:w-72">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Dates</p>
          <DateRangeInput
            from={range.from}
            to={range.to}
            max={todayKey}
            onChange={({ from, to }) => setRange({ from, to })}
            className="field py-2.5"
            aria-label="History date range"
          />
        </div>
        {data?.rows && <p className="col-span-2 text-xs text-muted sm:ml-auto sm:pb-3">{data.rows.length} site-day{data.rows.length === 1 ? "" : "s"}</p>}
      </div>
      {data?.fromCache && <p className="mb-2 text-xs text-chip-yellow-fg">Offline — showing the copy saved on this device.</p>}
      {isLoading && <p className="text-sm text-muted">Loading history…</p>}
      {isError && <p className="text-sm text-danger">{error?.response?.data?.error || "Couldn't load your history."}</p>}
      {data && !byDate.length && <EmptyState icon={History} title="No site activity in this period" description="Check-ins, check-outs and absences you mark show up here, per site." />}
      <div className="space-y-4">
        {byDate.map(([date, rows]) => (
          <div key={date}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(date, todayKey)}</p>
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={`${row.date}-${row.siteId || row.siteName}`} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink"><Building2 size={14} className="shrink-0 text-muted" /> <span className="truncate">{row.siteName}</span></p>
                      {row.projectName && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><FolderKanban size={11} /> {row.projectName}</p>}
                    </div>
                    <p className="flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-ink"><Clock size={13} className="text-muted" /> {row.firstLabel} – {row.lastLabel}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    <span className="rounded-full bg-surface-2 px-2.5 py-1 font-semibold text-ink"><Users size={11} className="mr-1 inline" />{row.employeesManaged} employee{row.employeesManaged === 1 ? "" : "s"}</span>
                    {row.actions.CHECK_IN > 0 && <span className="rounded-full bg-chip-green-bg px-2.5 py-1 font-semibold text-chip-green-fg">{row.actions.CHECK_IN} check-in{row.actions.CHECK_IN === 1 ? "" : "s"}</span>}
                    {row.actions.CHECK_OUT > 0 && <span className="rounded-full bg-chip-blue-bg px-2.5 py-1 font-semibold text-chip-blue-fg">{row.actions.CHECK_OUT} check-out{row.actions.CHECK_OUT === 1 ? "" : "s"}</span>}
                    {row.actions.MARK_ABSENT > 0 && <span className="rounded-full bg-chip-pink-bg px-2.5 py-1 font-semibold text-chip-pink-fg">{row.actions.MARK_ABSENT} absent</span>}
                    {row.offlineActions > 0 && <span className="rounded-full bg-chip-yellow-bg px-2.5 py-1 font-semibold text-chip-yellow-fg">{row.offlineActions} offline</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SiteAttendance() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const online = useOnline()
  const [tab, setTab] = useState("attendance")
  const [siteId, setSiteId] = useState(readSavedSite)
  const [projectFilter, setProjectFilter] = useState("")
  const [search, setSearch] = useState("")
  const [stateFilter, setStateFilter] = useState("")
  const [queue, setQueue] = useState([])
  const [rejections, setRejections] = useState(readSiteAdminRejections)
  const [message, setMessage] = useState(null) // { tone, text }
  const [busyId, setBusyId] = useState(null)
  const [correcting, setCorrecting] = useState(null)
  const [locationInfo, setLocationInfo] = useState(null)
  const [syncing, setSyncing] = useState(false)

  const { data: sitesData, isLoading: sitesLoading, isError: sitesError } = useQuery({
    queryKey: ["site-admin-sites", user?.id],
    queryFn: () => cachedGet("/site-admin/sites", "sites"),
  })
  const sites = sitesData?.sites || []
  const orgTimeZone = sitesData?.timezone
  const todayKey = sitesData?.today || new Date().toISOString().slice(0, 10)
  const projects = useMemo(() => [...new Map(sites.filter((s) => s.projectId).map((s) => [s.projectId, s.projectName])).entries()], [sites])
  const visibleSites = sites.filter((s) => !projectFilter || s.projectId === projectFilter)
  const site = sites.find((s) => s.id === siteId) || visibleSites.find((s) => s.usable) || null
  const timeZone = site?.timezone || orgTimeZone

  useEffect(() => {
    if (site && site.id !== siteId) setSiteId(site.id)
  }, [site, siteId])
  useEffect(() => {
    try { if (siteId) localStorage.setItem(SITE_KEY, siteId) } catch { /* convenience only */ }
  }, [siteId])

  const rosterKey = ["site-admin-roster", user?.id, site?.id, todayKey]
  const { data: roster, isLoading: rosterLoading, isError: rosterError, error: rosterErr } = useQuery({
    queryKey: rosterKey,
    queryFn: () => cachedGet(`/site-admin/sites/${site.id}/roster`, `roster:${site.id}:${todayKey}`, { date: todayKey }),
    enabled: !!site?.usable,
    refetchInterval: online ? 60000 : false,
  })

  const refreshQueue = useCallback(async () => {
    try { setQueue(await getSiteAdminQueue()) } catch { setQueue([]) }
  }, [])

  const runSync = useCallback(async () => {
    if (!navigator.onLine) return
    setSyncing(true)
    try {
      const result = await syncSiteAdminQueue(api)
      if (result.synced || result.duplicates) {
        queryClient.invalidateQueries({ queryKey: ["site-admin-roster"] })
        queryClient.invalidateQueries({ queryKey: ["site-admin-history"] })
      }
      if (result.synced) setMessage({ tone: "green", text: `${result.synced} offline action${result.synced === 1 ? "" : "s"} synced.` })
    } catch {
      // Network / server problem — the queue is kept and retried later.
    } finally {
      setSyncing(false)
      setRejections(readSiteAdminRejections())
      refreshQueue()
    }
  }, [queryClient, refreshQueue])

  useEffect(() => { refreshQueue() }, [refreshQueue])
  // Sync as soon as the connection is back, and every 30 s while anything waits.
  useEffect(() => { if (online) runSync() }, [online, runSync])
  useEffect(() => {
    if (!queue.length || !online) return
    const t = setInterval(runSync, 30000)
    return () => clearInterval(t)
  }, [queue.length, online, runSync])

  const pendingByEmployee = useMemo(() => {
    const map = new Map()
    for (const q of queue) {
      if (q.siteId !== site?.id) continue
      const key = q.employeeId
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(q)
    }
    for (const list of map.values()) list.sort((a, b) => String(a.localRecordedAt).localeCompare(String(b.localRecordedAt)))
    return map
  }, [queue, site?.id])

  async function act(employee, action) {
    if (!site) return
    if (action === "MARK_ABSENT" && !window.confirm(`Mark ${employee.name} absent today at ${site.name}?`)) return
    setBusyId(employee.id)
    setMessage(null)
    try {
      const position = site.geofenceMode === "DISABLED" ? null : await currentPosition()
      if (site.geofenceMode === "STRICT" && !position) {
        setMessage({ tone: "pink", text: `${site.name} needs your location. Turn on location for this browser and try again.` })
        return
      }
      const event = {
        clientEventId: newEventId(),
        siteId: site.id,
        employeeId: employee.id,
        action,
        localRecordedAt: new Date().toISOString(),
        deviceId: getAttendanceDeviceId(),
        ...(position || {}),
      }
      const queueIt = async () => {
        await queueSiteAdminAction(event)
        await refreshQueue()
        setMessage({ tone: "yellow", text: `${ACTION_LABEL[action]} for ${employee.name} saved on this device at ${formatTime(event.localRecordedAt, { timeZone })}. It syncs automatically when you're online.` })
      }
      if (!navigator.onLine) return await queueIt()
      try {
        const { data } = await api.post("/site-admin/attendance", event)
        const label = data?.duplicate ? "Already recorded" : `${ACTION_LABEL[action]} recorded`
        setMessage({ tone: "green", text: `${label} — ${employee.name}${data?.record?.checkInLabel && action === "CHECK_IN" ? ` at ${data.record.checkInLabel}` : ""}${data?.record?.dayType === "HALF_DAY" ? " (half day)" : ""}.` })
        queryClient.invalidateQueries({ queryKey: ["site-admin-roster"] })
        queryClient.invalidateQueries({ queryKey: ["site-admin-history"] })
      } catch (err) {
        // No response = connection dropped mid-request: queue it. The server
        // ignores it on sync if the first attempt actually got through.
        if (isNetworkError(err)) return await queueIt()
        setMessage({ tone: "pink", text: err.response?.data?.error || "Couldn't record that — please try again." })
        queryClient.invalidateQueries({ queryKey: ["site-admin-roster"] })
      }
    } finally {
      setBusyId(null)
    }
  }

  async function checkLocation() {
    if (!site) return
    setLocationInfo({ checking: true })
    const p = await currentPosition(10000)
    if (!p) return setLocationInfo({ error: "Location unavailable — allow location access for this site." })
    const R = 6371000
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(site.latitude - p.latitude)
    const dLng = toRad(site.longitude - p.longitude)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(p.latitude)) * Math.cos(toRad(site.latitude)) * Math.sin(dLng / 2) ** 2
    const distance = Math.round(2 * R * Math.asin(Math.sqrt(a)))
    setLocationInfo({ distance, accuracy: Math.round(p.gpsAccuracy || 0), polygon: site.geofenceType === "POLYGON", inside: site.geofenceType !== "POLYGON" ? distance <= site.radiusMeters : null })
  }

  const employees = roster?.employees || []
  const counts = useMemo(() => {
    const c = { NOT_CHECKED_IN: 0, CHECKED_IN: 0, CHECKED_OUT: 0, ABSENT: 0 }
    for (const e of employees) {
      const queued = pendingByEmployee.get(e.id)?.slice(-1)[0]
      const state = queued ? (queued.action === "CHECK_IN" ? "CHECKED_IN" : queued.action === "CHECK_OUT" ? "CHECKED_OUT" : "ABSENT") : e.state === "MARKED" ? "CHECKED_IN" : e.state
      if (c[state] !== undefined) c[state] += 1
    }
    return c
  }, [employees, pendingByEmployee])
  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase()
    if (q && !e.name.toLowerCase().includes(q) && !(e.projectName || "").toLowerCase().includes(q)) return false
    if (!stateFilter) return true
    const queued = pendingByEmployee.get(e.id)?.slice(-1)[0]
    const state = queued ? (queued.action === "CHECK_IN" ? "CHECKED_IN" : queued.action === "CHECK_OUT" ? "CHECKED_OUT" : "ABSENT") : e.state === "MARKED" ? "CHECKED_IN" : e.state
    return state === stateFilter
  })

  return (
    <div className="min-w-0">
      <PageHeader title="Site Attendance" subtitle="Mark check-in, check-out and absence for workers at your sites." back={false} />

      {/* Connection + sync status */}
      <div className={`mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-sm ${online ? "bg-chip-green-bg text-chip-green-fg" : "bg-chip-yellow-bg text-chip-yellow-fg"}`}>
        <span className="flex items-center gap-2 font-semibold">
          {online ? <Wifi size={16} /> : <WifiOff size={16} />}
          {online ? "Online" : "Offline — actions are saved on this device"}
        </span>
        <span className="flex items-center gap-2 text-xs">
          {queue.length > 0 ? `${queue.length} waiting to sync` : "Everything synced"}
          {queue.length > 0 && online && (
            <button type="button" onClick={runSync} disabled={syncing} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 font-semibold text-ink disabled:opacity-50">
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </span>
      </div>

      {rejections.length > 0 && (
        <div className="mb-3 rounded-2xl bg-chip-pink-bg px-4 py-3 text-xs text-chip-pink-fg">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">{rejections.length} offline action{rejections.length === 1 ? "" : "s"} couldn't be saved</p>
            <button type="button" onClick={() => { clearSiteAdminRejections(); setRejections([]) }} className="font-semibold underline">Dismiss</button>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {rejections.slice(0, 6).map((r) => (
              <li key={r.clientEventId || r.at}>
                {r.event ? `${ACTION_LABEL[r.event.action] || r.event.action} (${formatTime(r.event.localRecordedAt, { timeZone })}): ` : ""}{r.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex rounded-2xl border border-border bg-surface p-1 sm:max-w-md" role="tablist">
        {[["attendance", ClipboardList, "Attendance"], ["history", History, "Site history"]].map(([key, Icon, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${tab === key ? "bg-accent text-on-accent shadow-sm" : "text-muted hover:text-ink"}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <HistoryTab todayKey={todayKey} />
      ) : (
        <>
          {sitesLoading && <p className="text-sm text-muted">Loading your sites…</p>}
          {sitesError && <p className="text-sm text-danger">Couldn't load your sites.</p>}
          {sitesData && !sites.length && (
            <EmptyState icon={MapPin} title="No sites assigned to you" description="An Admin assigns sites to you from Attendance Sites. Once assigned, the site's workers appear here." />
          )}

          {sites.length > 0 && (
            <div className="card mb-4 space-y-3 p-4">
              <div className={`grid items-end gap-3 ${projects.length > 1 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                {projects.length > 1 && (
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Project
                    <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="field mt-1.5 h-12 py-0 text-sm normal-case tracking-normal">
                      <option value="">All projects</option>
                      {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                )}
                <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                  Site
                  <select value={site?.id || ""} onChange={(e) => { setSiteId(e.target.value); setLocationInfo(null); setStateFilter("") }} className="field mt-1.5 h-12 py-0 text-sm font-semibold normal-case tracking-normal text-ink">
                    {visibleSites.map((s) => (
                      <option key={s.id} value={s.id} disabled={!s.usable}>
                        {s.name}{s.projectName ? ` · ${s.projectName}` : ""}{!s.usable ? " (closed)" : ` · ${s.employeeCount}`}
                      </option>
                    ))}
                  </select>
                </label>
                {site?.usable && (
                  <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
                    Employee
                    <span className="mt-1.5 flex h-12 items-center gap-2 rounded-2xl border border-border bg-surface-2 px-4 normal-case tracking-normal focus-within:border-accent">
                      <Search size={16} className="shrink-0 text-muted-2" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or project" className="min-w-0 flex-1 bg-transparent text-sm font-normal text-ink outline-none placeholder:text-muted-2" aria-label="Search employee" />
                      {search && <button type="button" onClick={() => setSearch("")} className="text-muted-2" aria-label="Clear search"><X size={15} /></button>}
                    </span>
                  </label>
                )}
              </div>
              {site && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1"><MapPin size={12} /> {site.address || "No address"}</span>
                    <span className="rounded-full bg-surface-2 px-2.5 py-1">Geofence: {site.geofenceMode === "STRICT" ? "strict (on-site only)" : site.geofenceMode === "DISABLED" ? "off" : "warning"}</span>
                    <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1"><Clock size={12} /> {timeZone}</span>
                  </span>
                  {site.geofenceMode !== "DISABLED" && (
                    <button type="button" onClick={checkLocation} className="inline-flex items-center gap-1 font-semibold text-accent">
                      <Navigation size={12} /> {locationInfo?.checking ? "Checking…" : "Check my location"}
                    </button>
                  )}
                </div>
              )}
              {locationInfo && !locationInfo.checking && (
                <p className={`rounded-xl px-3 py-2 text-xs ${locationInfo.error ? "bg-chip-pink-bg text-chip-pink-fg" : locationInfo.inside === false ? "bg-chip-yellow-bg text-chip-yellow-fg" : "bg-chip-green-bg text-chip-green-fg"}`}>
                  {locationInfo.error || `${locationInfo.distance}m from the site centre (±${locationInfo.accuracy}m).${locationInfo.polygon ? " The server checks the exact boundary." : locationInfo.inside ? " Inside the site." : " Outside the site radius."}`}
                </p>
              )}
            </div>
          )}

          {site && !site.usable && <EmptyState title="This site is closed" description="It's inactive or its project is completed, so attendance can't be marked here." />}

          {site?.usable && (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {[["NOT_CHECKED_IN", "Not checked in", "bg-muted-2"], ["CHECKED_IN", "Checked in", "bg-success"], ["CHECKED_OUT", "Checked out", "bg-info"], ["ABSENT", "Absent", "bg-danger"]].map(([key, label, dot]) => (
                  <button key={key} type="button" onClick={() => setStateFilter((v) => (v === key ? "" : key))} aria-pressed={stateFilter === key}
                    className={`flex min-h-[84px] flex-col justify-between rounded-2xl border p-4 text-left transition-colors ${stateFilter === key ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2"}`}>
                    <span className="flex items-center gap-2 text-xs font-semibold text-muted"><span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />{label}</span>
                    <span className="text-2xl font-semibold tabular-nums text-ink">{counts[key]}</span>
                  </button>
                ))}
              </div>

              {message && (
                <div className={`mb-3 flex items-start justify-between gap-2 rounded-2xl px-4 py-2.5 text-sm ${message.tone === "green" ? "bg-chip-green-bg text-chip-green-fg" : message.tone === "yellow" ? "bg-chip-yellow-bg text-chip-yellow-fg" : "bg-chip-pink-bg text-chip-pink-fg"}`} role="status">
                  <span className="flex items-start gap-2">{message.tone === "green" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}{message.text}</span>
                  <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss"><X size={14} /></button>
                </div>
              )}

              {roster?.fromCache && <p className="mb-2 text-xs text-chip-yellow-fg">Offline — showing the roster saved on this device.</p>}
              {rosterLoading && <p className="text-sm text-muted">Loading employees…</p>}
              {rosterError && <p className="text-sm text-danger">{rosterErr?.response?.data?.error || "Couldn't load this site's employees."}</p>}
              {roster && !employees.length && (
                <EmptyState icon={Users} title="No employees on this site" description="An Admin assigns workers to the site directly or through its project." />
              )}

              <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((e) => (
                  <EmployeeCard
                    key={e.id}
                    employee={e}
                    site={site}
                    timeZone={timeZone}
                    pending={pendingByEmployee.get(e.id)}
                    busy={busyId === e.id}
                    onAction={act}
                    onCorrect={setCorrecting}
                  />
                ))}
              </div>
              {roster && employees.length > 0 && !filtered.length && <p className="py-6 text-center text-sm text-muted">No employees match.</p>}
            </>
          )}
        </>
      )}

      {correcting && site && (
        <CorrectionModal
          employee={correcting}
          site={site}
          date={todayKey}
          timeZone={timeZone}
          onClose={() => setCorrecting(null)}
          onSent={() => {
            setMessage({ tone: "green", text: `Correction request for ${correcting.name} sent to HR.` })
            queryClient.invalidateQueries({ queryKey: ["site-admin-roster"] })
          }}
        />
      )}
    </div>
  )
}
