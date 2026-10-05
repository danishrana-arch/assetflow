import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LogIn, LogOut, CheckCircle2, Loader2 } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { getAttendanceDeviceId } from "../utils/offlineAttendance"
import { formatTime } from "../utils/time"

// One-click check in / check out for the main roles (CEO, Admin, HR) right on
// the dashboard. Same endpoints and rules as My Attendance — the server still
// applies the late rule, geofence and site checks — just without the extra
// screens. Online only; anything unusual links to My Attendance.
export const QUICK_ATTENDANCE_ROLES = ["CEO", "ADMIN", "HR"]

function newEventId() {
  return `att-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`
}

// Best effort: a check-in without coordinates is fine unless the server needs
// them (then it says so and we point to My Attendance).
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 })
  })
}

export default function QuickAttendance({ className = "" }) {
  const { user, organization } = useAuth()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState("")
  const [message, setMessage] = useState(null) // { tone: "ok" | "warn" | "error", text }

  const { data, isLoading } = useQuery({
    // Same key as My Attendance, so both stay in step.
    queryKey: ["attendance-self", user?.id],
    queryFn: () => api.get("/attendance/self").then((r) => r.data),
    enabled: !!user?.id,
    staleTime: 30000,
  })

  if (!QUICK_ATTENDANCE_ROLES.includes(user?.role)) return null

  const timeZone = data?.timezone || organization?.timezone
  const today = data?.today
  const checkedIn = !!today?.checkInAt
  const checkedOut = !!today?.checkOutAt
  const onLeave = today?.status === "LEAVE"

  async function checkIn() {
    setBusy("in")
    setMessage(null)
    try {
      const position = await getPosition()
      const { data: res } = await api.post("/attendance/self/mark", {
        status: "PRESENT",
        latitude: position?.coords.latitude ?? null,
        longitude: position?.coords.longitude ?? null,
        gpsAccuracy: position?.coords.accuracy ?? null,
        locationMode: "OFFICE",
        clientEventId: newEventId(),
      })
      setMessage(res?.outsideSite
        ? { tone: "warn", text: res.message || "Checked in outside the office — recorded as Late for HR review." }
        : { tone: "ok", text: "Checked in." })
    } catch (err) {
      setMessage({ tone: "error", text: err.response?.data?.error || "Could not check in. Try again from My Attendance." })
    } finally {
      setBusy("")
      queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
    }
  }

  async function checkOut() {
    setBusy("out")
    setMessage(null)
    try {
      const position = await getPosition()
      const now = new Date()
      const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      // Check-out goes through the same timestamp-preserving endpoint My
      // Attendance uses.
      const { data: res } = await api.post("/attendance/self/offline-sync", {
        events: [{
          type: "CHECK_OUT",
          localRecordedAt: now.toISOString(),
          localDate: new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now),
          timezone: tz,
          locationMode: today?.locationMode || "OFFICE",
          latitude: position?.coords.latitude ?? null,
          longitude: position?.coords.longitude ?? null,
          gpsAccuracy: position?.coords.accuracy ?? null,
          deviceId: getAttendanceDeviceId(),
          networkType: navigator.connection?.effectiveType || "online",
          clientEventId: newEventId(),
        }],
      })
      if (res?.rejected?.length) {
        setMessage({ tone: "error", text: res.rejected[0].error || "Could not check out. Try again from My Attendance." })
      } else {
        setMessage({ tone: "ok", text: "Checked out." })
      }
    } catch (err) {
      setMessage({ tone: "error", text: err.response?.data?.error || "Could not check out. Try again from My Attendance." })
    } finally {
      setBusy("")
      queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
    }
  }

  const time = (value) => formatTime(value, { timeZone })
  const toneClass = { ok: "text-chip-green-fg", warn: "text-chip-yellow-fg", error: "text-chip-pink-fg" }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {isLoading ? (
        <span className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface/80 px-4 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" /> Attendance…
        </span>
      ) : onLeave ? (
        <span className="inline-flex h-9 items-center rounded-full border border-border bg-surface/80 px-4 text-xs font-semibold text-muted">On leave today</span>
      ) : !checkedIn ? (
        <button
          type="button"
          onClick={checkIn}
          disabled={!!busy}
          className="pill-accent inline-flex h-9 items-center gap-2 px-4 text-xs font-semibold disabled:opacity-60"
        >
          {busy === "in" ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {busy === "in" ? "Checking in…" : "Check in"}
        </button>
      ) : !checkedOut ? (
        <>
          <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 text-xs text-muted">
            <CheckCircle2 size={14} className="text-chip-green-fg" /> In since <b className="text-ink">{time(today.checkInAt)}</b>
          </span>
          <button
            type="button"
            onClick={checkOut}
            disabled={!!busy}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            {busy === "out" ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            {busy === "out" ? "Checking out…" : "Check out"}
          </button>
        </>
      ) : (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface/80 px-3 text-xs text-muted">
          <CheckCircle2 size={14} className="text-chip-green-fg" />
          Done today · <b className="text-ink">{time(today.checkInAt)} – {time(today.checkOutAt)}</b>
        </span>
      )}
      {message && (
        <span className={`text-[11px] font-medium ${toneClass[message.tone]}`}>
          {message.text}
          {message.tone !== "ok" && (
            <> <Link to="/attendance/me" className="underline">My Attendance</Link></>
          )}
        </span>
      )}
    </div>
  )
}
