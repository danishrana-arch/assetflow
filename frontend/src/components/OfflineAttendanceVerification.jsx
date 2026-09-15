import { useState } from "react"
import { Camera, CheckCircle2, Download, MapPin, WifiOff } from "lucide-react"

function value(v, fallback = "Not available") {
  return v === null || v === undefined || v === "" ? fallback : v
}

export default function OfflineAttendanceVerification({ record, site }) {
  const [saving, setSaving] = useState(false)

  if (!record) return null

  async function saveVerificationImage() {
    setSaving(true)
    try {
      const canvas = document.createElement("canvas")
      canvas.width = 1200
      canvas.height = 900
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#f6f7f5"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = "#111313"
      ctx.font = "700 42px Arial"
      ctx.fillText("AssetFlow Attendance Verification", 70, 90)

      ctx.font = "700 30px Arial"
      ctx.fillText(record.type === "CHECK_OUT" ? "CHECK OUT RECORDED" : "CHECK IN RECORDED", 70, 155)

      ctx.font = "500 25px Arial"
      const lines = [
        `Employee: ${value(record.employeeName)}`,
        `Date: ${value(record.localDate)}`,
        `Recorded time: ${new Date(record.localRecordedAt).toLocaleString()}`,
        `Time zone: ${value(record.timezone)}`,
        `Site: ${value(site?.name || record.siteName)}`,
        `Latitude: ${value(record.latitude)}`,
        `Longitude: ${value(record.longitude)}`,
        `GPS accuracy: ${value(record.gpsAccuracy, "Not reported")} m`,
        `Distance from site: ${value(record.distanceMeters, "Not calculated")} m`,
        `Network: OFFLINE`,
        `Sync status: PENDING`,
        `Attendance Event ID: ${value(record.clientEventId)}`,
      ]
      lines.forEach((line, i) => ctx.fillText(line, 70, 220 + i * 45))

      ctx.font = "600 23px Arial"
      ctx.fillText("This image is an additional employee-held verification view.", 70, 790)
      ctx.fillText("The authoritative record is the AssetFlow attendance event after synchronization.", 70, 830)

      const link = document.createElement("a")
      link.download = `AssetFlow-Attendance-${record.clientEventId || Date.now()}.png`
      link.href = canvas.toDataURL("image/png")
      link.click()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-chip-green-bg text-chip-green-fg">
            <CheckCircle2 size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink">Offline attendance recorded</p>
            <p className="text-[11px] text-muted">Keep this verification view if you need additional evidence.</p>
          </div>
        </div>
        <WifiOff size={16} className="text-muted" />
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Recorded</p>
          <p className="mt-1 text-sm font-semibold text-ink">{new Date(record.localRecordedAt).toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted">{value(record.timezone)}</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Site</p>
          <p className="mt-1 text-sm font-semibold text-ink">{value(site?.name || record.siteName)}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin size={11} /> {value(record.distanceMeters, "Location distance unavailable")} {record.distanceMeters != null ? "m from site" : ""}</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Location</p>
          <p className="mt-1 text-xs font-medium text-ink">{value(record.latitude)}, {value(record.longitude)}</p>
          <p className="mt-1 text-xs text-muted">GPS accuracy: {value(record.gpsAccuracy, "Not reported")} m</p>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Sync</p>
          <p className="mt-1 text-sm font-semibold text-chip-yellow-fg">Saved offline · Pending sync</p>
          <p className="mt-1 break-all text-[10px] text-muted-2">Event ID: {value(record.clientEventId)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border p-4">
        <button
          type="button"
          onClick={saveVerificationImage}
          disabled={saving}
          className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60"
        >
          <Camera size={15} />
          {saving ? "Preparing…" : "Save verification image"}
        </button>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-2">
          <Download size={13} /> Includes time, timezone, site, GPS, accuracy, distance, sync state and event ID.
        </span>
      </div>
    </div>
  )
}
