import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Save, Download, CheckCircle2, XCircle, Palmtree, MapPin, AlertTriangle } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import EmptyState from "../components/ui/EmptyState"

const STATUS_CONFIG = {
  PRESENT: { label: "Present", tone: "green", icon: CheckCircle2 },
  ABSENT: { label: "Absent", tone: "pink", icon: XCircle },
  LEAVE: { label: "Leave", tone: "yellow", icon: Palmtree },
}


function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "—"
  const value = Math.max(0, Number(minutes) || 0)
  const hours = Math.floor(value / 60)
  const mins = value % 60
  return `${hours}h ${mins.toString().padStart(2, "0")}m`
}

function formatPunchTime(value) {
  if (!value) return "—"
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function statusPill(status) {
  const cfg = STATUS_CONFIG[status] || { label: status, tone: "slate" }
  return <StatusPill tone={cfg.tone}>{cfg.label}</StatusPill>
}

function mapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

// Shown next to a row when the employee's "Present" attempt landed
// outside the office geofence and was auto-flipped to Absent by the
// system. Admin can click through to see exactly where they were, then
// use the status buttons to override the call either way.
function LocationFlag({ row }) {
  const hasLocation = row.latitude != null && row.longitude != null

  if (!hasLocation) {
    if (row.workLocationType === "FIELD") {
      return (
        <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">
          <MapPin size={10} /> Field employee · No location
        </span>
      )
    }
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-2">
        <MapPin size={10} /> No location recorded
      </span>
    )
  }

  return (
    <div className="mt-1 space-y-0.5">
      <a
        href={mapsLink(row.latitude, row.longitude)}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide hover:underline ${
          row.autoFlagged ? "text-chip-pink-fg" : "text-muted"
        }`}
        title="Open the exact recorded attendance location in Google Maps"
      >
        {row.autoFlagged ? <AlertTriangle size={10} /> : <MapPin size={10} />}
        {row.autoFlagged
          ? row.distanceMeters != null
            ? `${row.distanceMeters}m away · View exact location`
            : "Outside office · View exact location"
          : "View exact location"}
      </a>
      <p className="text-[10px] text-muted-2">
        {Number(row.latitude).toFixed(6)}, {Number(row.longitude).toFixed(6)}
      </p>
    </div>
  )
}

export default function Attendance() {
  const { user } = useAuth()
  const hasAccess = user?.role === "ADMIN" || !!user?.canManageAttendance
  const queryClient = useQueryClient()
  const [date] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", date],
    queryFn: () => api.get("/attendance", { params: { date } }).then((r) => r.data),
    enabled: hasAccess,
  })

  useEffect(() => {
    if (data?.rows) { setRows(data.rows); setDirty(false) }
  }, [data])

  function setLocalStatus(employeeId, status) {
    const nowIso = new Date().toISOString()
    setRows((prev) =>
      prev.map((r) =>
        r.employeeId === employeeId
          ? { ...r, status, time: nowIso, markedByName: user?.name || r.markedByName, autoFlagged: false }
          : r
      )
    )
    setDirty(true); setSaved(false)
  }

  const saveDay = useMutation({
    mutationFn: () =>
      api.post("/attendance/save", { date, records: rows.map((r) => ({ employeeId: r.employeeId, status: r.status })) }),
    onSuccess: () => {
      setDirty(false); setSaved(true)
      queryClient.invalidateQueries({ queryKey: ["attendance", date] })
    },
  })

  async function exportSheet() {
    const res = await api.get("/attendance/export", { params: { date }, responseType: "blob" })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", `Attendance_${date}.xlsx`)
    document.body.appendChild(link); link.click(); link.remove()
    setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  }

  if (!hasAccess) {
    return (
      <EmptyState
        title="Attendance is admin-only"
        description="Contact an org admin if you need access to manage attendance."
      />
    )
  }

  const presentCount = rows.filter((r) => r.status === "PRESENT").length

  return (
    <div>
      <PageHeader
        backTo="/"
        title={`Attendance · ${data?.date || date}`}
        subtitle={
          <span>
            {presentCount} of {rows.length} marked present
            {data?.schedule && <span className="ml-2">· {data.schedule.workingHoursPerDay}h/day · {data.schedule.workingDaysPerWeek} days/week</span>}
            {dirty && <span className="ml-2 rounded-full bg-chip-yellow-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chip-yellow-fg">Unsaved</span>}
            {saved && !dirty && <span className="ml-2 rounded-full bg-chip-green-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-chip-green-fg">Saved</span>}
          </span>
        }
        actions={
          <>
            <button onClick={exportSheet} className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm">
              <Download size={15} /> Export
            </button>
            <button
              onClick={() => saveDay.mutate()}
              disabled={!dirty || saveDay.isPending}
              className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-40"
            >
              <Save size={15} />
              {saveDay.isPending ? "Saving…" : "Save"}
            </button>
          </>
        }
      />

      {isLoading && <p className="text-sm text-muted">Loading...</p>}

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={row.employeeId} className="card p-4">
            <div className="flex items-center gap-3">
              <Avatar name={row.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{row.name}</p>
                <p className="truncate text-xs text-muted">{row.department || "—"}</p>
                {row.time && (
                  <p className="mt-0.5 text-xs text-muted-2">{new Date(row.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                )}
                <p className="mt-0.5 text-xs text-muted-2">
                  {formatPunchTime(row.checkInAt)} → {formatPunchTime(row.checkOutAt)} · {formatMinutes(row.workingMinutes)}
                </p>
                {row.markedByName && (
                  <p className="mt-0.5 text-xs text-muted-2">Marked by {row.markedByName}</p>
                )}
                <LocationFlag row={row} />
              </div>
              {statusPill(row.status)}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setLocalStatus(row.employeeId, key)}
                  className={`flex items-center justify-center gap-1.5 rounded-full py-2 text-[11px] font-semibold transition-colors ${
                    row.status === key
                      ? `bg-chip-${cfg.tone}-bg text-chip-${cfg.tone}-fg`
                      : "bg-surface-2 text-muted hover:text-ink"
                  }`}
                >
                  <cfg.icon size={12} strokeWidth={2.5} />
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && !isLoading && <EmptyState title="No active employees" />}
      </div>

      <div className="hidden card overflow-hidden md:block">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
            <tr className="border-b border-border">
              <th className="px-5 py-3.5">Employee</th>
              <th className="px-5 py-3.5">Department</th>
              <th className="px-5 py-3.5">Check in / out</th>
              <th className="px-5 py-3.5">Working time</th>
              <th className="px-5 py-3.5">Location</th>
              <th className="px-5 py-3.5">Status</th>
              <th className="px-5 py-3.5">Mark</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.employeeId} className="border-b border-border last:border-0 hover:bg-surface-2">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={row.name} size="sm" />
                    <p className="font-semibold text-ink">{row.name}</p>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-muted">{row.department || "—"}</td>
                <td className="px-5 py-3.5 text-muted">{formatPunchTime(row.checkInAt)} → {formatPunchTime(row.checkOutAt)}</td>
                <td className="px-5 py-3.5 font-medium text-ink">{formatMinutes(row.workingMinutes)}</td>
                <td className="px-5 py-3.5">
                  <LocationFlag row={row} />
                </td>
                <td className="px-5 py-3.5">
                  {statusPill(row.status)}
                </td>
                <td className="px-5 py-3.5">
                  <div className="flex gap-1.5">
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => setLocalStatus(row.employeeId, key)}
                        className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                          row.status === key
                            ? `bg-chip-${cfg.tone}-bg text-chip-${cfg.tone}-fg`
                            : "bg-surface-2 text-muted hover:text-ink"
                        }`}
                      >
                        <cfg.icon size={11} strokeWidth={2.5} />
                        {cfg.label}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isLoading && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-muted">No active employees.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
