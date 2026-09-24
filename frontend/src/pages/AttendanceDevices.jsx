import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, RefreshCw, Copy, DoorOpen, Wifi, WifiOff, Pencil, Check, X } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField } from "../components/ui/Field"
import { useAuth } from "../context/AuthContext"

const VENDORS = ["ZKTECO", "HIKVISION", "SUPREMA", "ANVIZ", "ESSL", "HTTP", "CUSTOM"]
const MODES = ["PULL", "PUSH", "HTTP"]

const EMPTY_FORM = { name: "", vendor: "ZKTECO", model: "", serialNumber: "", ipAddress: "", port: 4370, connectionMode: "PULL", doorEnabled: false, unlockSeconds: 5, relayUrl: "", relaySecret: "", enabled: true }

function errorText(err, fallback) {
  return err?.response?.data?.error || fallback
}

function isOnline(device) {
  return device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 120000
}

// The ADMS "Server Address" a device's own Comm menu needs: this backend's
// host plus /assetflow/<org slug> — the device appends /iclock/... itself.
function admsServerAddress(slug) {
  const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:4000/api"
  const host = apiUrl.replace(/^https?:\/\//, "").replace(/\/api\/?$/, "").replace(/\/$/, "")
  return `${host}/assetflow/${slug}`
}

function CopyButton({ value, label = "Copy" }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="pill-secondary flex items-center gap-1 px-3 py-2 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : label}
    </button>
  )
}

function DeviceForm({ initial, submitLabel, submitting, error, onSubmit, onCancel, isEdit = false }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial, relaySecret: "" })
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  function submit() {
    const payload = {
      name: form.name.trim(),
      vendor: form.vendor,
      model: form.model,
      serialNumber: form.serialNumber.trim(),
      ipAddress: form.ipAddress.trim(),
      port: form.port === "" ? null : Number(form.port),
      connectionMode: form.connectionMode,
      doorEnabled: form.doorEnabled,
      unlockSeconds: Number(form.unlockSeconds || 5),
      relayUrl: form.relayUrl.trim(),
    }
    if (isEdit) payload.enabled = form.enabled
    // Blank means "keep what's saved" when editing — the secret is never sent back to the browser.
    if (form.relaySecret) payload.relaySecret = form.relaySecret
    onSubmit(payload)
  }

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Device name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Main Office Door" />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Vendor</label>
          <select className="input w-full" value={form.vendor} onChange={(e) => set("vendor", e.target.value)}>
            {VENDORS.map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
        <TextField label="Model" value={form.model || ""} onChange={(e) => set("model", e.target.value)} placeholder="K40 / F22 / SpeedFace" />
        <TextField label="Serial number" value={form.serialNumber || ""} onChange={(e) => set("serialNumber", e.target.value)} placeholder="From the device's System Info screen" />
        <TextField label="Local IP" value={form.ipAddress || ""} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.1.201" />
        <TextField label="Port" type="number" value={form.port ?? ""} onChange={(e) => set("port", e.target.value)} />
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Connection</label>
          <select className="input w-full" value={form.connectionMode} onChange={(e) => set("connectionMode", e.target.value)}>
            {MODES.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <TextField label="Relay URL (optional)" value={form.relayUrl || ""} onChange={(e) => set("relayUrl", e.target.value)} placeholder="http://192.168.1.50/unlock" />
        <TextField
          label={isEdit ? "Relay secret (leave blank to keep current)" : "Relay secret (optional)"}
          type="password"
          value={form.relaySecret}
          onChange={(e) => set("relaySecret", e.target.value)}
        />
        <TextField label="Unlock seconds" type="number" min={1} max={120} value={form.unlockSeconds} onChange={(e) => set("unlockSeconds", e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.doorEnabled} onChange={(e) => set("doorEnabled", e.target.checked)} /> Unlock door after successful biometric
        </label>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Device enabled (disabled devices can't sync)
          </label>
        )}
      </div>
      {error && <p className="mt-4 text-sm text-chip-pink-fg">{error}</p>}
      <div className="mt-5 flex gap-2">
        <button className="pill-accent px-4 py-2" disabled={submitting || !form.name.trim()} onClick={submit}>
          {submitting ? "Saving…" : submitLabel}
        </button>
        <button className="pill-secondary px-4 py-2" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function MappingRow({ deviceId, mapping, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [externalUserId, setExternalUserId] = useState(mapping.externalUserId)

  const save = useMutation({
    mutationFn: () => api.post(`/biometric/devices/${deviceId}/mappings`, { employeeId: mapping.employeeId, externalUserId: externalUserId.trim() }),
    onSuccess: () => { setEditing(false); onChanged() },
  })
  const remove = useMutation({
    mutationFn: () => api.delete(`/biometric/devices/${deviceId}/mappings/${mapping.id}`),
    onSuccess: onChanged,
  })

  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="min-w-[140px] flex-1 text-sm text-ink">{mapping.employee?.name || "Unknown employee"}</span>
      {editing ? (
        <>
          <input className="input w-28 text-xs" value={externalUserId} onChange={(e) => setExternalUserId(e.target.value)} />
          <button className="pill-secondary px-2 py-1.5 text-xs" disabled={save.isPending || !externalUserId.trim()} onClick={() => save.mutate()} aria-label="Save device user ID">
            <Check size={13} />
          </button>
          <button className="pill-secondary px-2 py-1.5 text-xs" onClick={() => { setEditing(false); setExternalUserId(mapping.externalUserId); save.reset() }} aria-label="Cancel">
            <X size={13} />
          </button>
        </>
      ) : (
        <>
          <span className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">ID {mapping.externalUserId}</span>
          <button className="rounded-xl px-2 py-1.5 text-xs text-muted hover:bg-surface-2" onClick={() => setEditing(true)} aria-label="Edit device user ID">
            <Pencil size={13} />
          </button>
          <button
            className="rounded-xl px-2 py-1.5 text-xs text-red-600 hover:bg-red-50"
            disabled={remove.isPending}
            onClick={() => { if (confirm(`Remove ${mapping.employee?.name || "this employee"} from this device?`)) remove.mutate() }}
            aria-label="Remove mapping"
          >
            <Trash2 size={13} />
          </button>
        </>
      )}
      {(save.isError || remove.isError) && (
        <span className="w-full text-xs text-chip-pink-fg">{errorText(save.error || remove.error, "Could not update mapping")}</span>
      )}
    </li>
  )
}

function MappingsSection({ device, employees }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState({ employeeId: "", externalUserId: "" })
  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ["biometric-mappings", device.id],
    queryFn: () => api.get(`/biometric/devices/${device.id}/mappings`).then((r) => r.data),
  })

  function refresh() {
    qc.invalidateQueries({ queryKey: ["biometric-mappings", device.id] })
    qc.invalidateQueries({ queryKey: ["biometric-devices"] })
  }

  const add = useMutation({
    mutationFn: () => api.post(`/biometric/devices/${device.id}/mappings`, { employeeId: draft.employeeId, externalUserId: draft.externalUserId.trim() }),
    onSuccess: () => { setDraft({ employeeId: "", externalUserId: "" }); refresh() },
  })

  const mappedIds = new Set(mappings.map((m) => m.employeeId))
  const available = employees.filter((e) => e.status === "ACTIVE" && !mappedIds.has(e.id))

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Employee mapping ({mappings.length})</p>
      {isLoading ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : mappings.length ? (
        <ul className="mb-3 max-h-64 divide-y divide-border overflow-y-auto">
          {mappings.map((m) => <MappingRow key={m.id} deviceId={device.id} mapping={m} onChanged={refresh} />)}
        </ul>
      ) : (
        <p className="mb-3 text-xs text-muted">No employees mapped yet — punches from this device won't count for anyone until they are.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input min-w-[180px]" value={draft.employeeId} onChange={(e) => setDraft((d) => ({ ...d, employeeId: e.target.value }))}>
          <option value="">Select employee</option>
          {available.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input className="input min-w-[140px]" placeholder="Device User ID" value={draft.externalUserId} onChange={(e) => setDraft((d) => ({ ...d, externalUserId: e.target.value }))} />
        <button
          className="pill-secondary px-3 py-2 text-xs disabled:opacity-60"
          disabled={!draft.employeeId || !draft.externalUserId.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? "Saving…" : "Add mapping"}
        </button>
        {add.isError && <span className="text-xs text-chip-pink-fg">{errorText(add.error, "Could not save mapping")}</span>}
      </div>
    </div>
  )
}

function DeviceCard({ device, employees, onToken }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ["biometric-devices"] })

  const update = useMutation({
    mutationFn: (payload) => api.patch(`/biometric/devices/${device.id}`, payload).then((r) => r.data),
    onSuccess: () => { setEditing(false); refresh() },
  })
  const rotate = useMutation({
    mutationFn: () => api.post(`/biometric/devices/${device.id}/rotate-token`).then((r) => r.data),
    onSuccess: (r) => onToken(r.connectorToken),
  })
  const remove = useMutation({ mutationFn: () => api.delete(`/biometric/devices/${device.id}`), onSuccess: refresh })

  if (editing) {
    return (
      <div className="card p-5">
        <SectionHeader title={`Edit ${device.name}`} />
        <DeviceForm
          initial={device}
          isEdit
          submitLabel="Save changes"
          submitting={update.isPending}
          error={update.isError ? errorText(update.error, "Could not save device") : ""}
          onSubmit={(payload) => update.mutate(payload)}
          onCancel={() => { setEditing(false); update.reset() }}
        />
      </div>
    )
  }

  const online = isOnline(device)
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">{device.name}</h3>
          <p className="mt-1 text-xs text-muted">{device.vendor}{device.model ? ` · ${device.model}` : ""}{!device.enabled ? " · Disabled" : ""}</p>
        </div>
        <span className={`flex items-center gap-1 text-xs font-medium ${online ? "text-chip-green-fg" : "text-muted"}`}>
          {online ? <><Wifi size={14} /> Online</> : <><WifiOff size={14} /> Offline</>}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted">
        <div>Serial: <b className="text-ink">{device.serialNumber || "—"}</b></div>
        <div>Mode: <b className="text-ink">{device.connectionMode}</b></div>
        <div>IP: <b className="text-ink">{device.ipAddress || "—"}</b></div>
        <div>Port: <b className="text-ink">{device.port || "—"}</b></div>
        <div>Door: <b className="text-ink">{device.doorEnabled ? `${device.unlockSeconds}s` : "Off"}</b></div>
        <div>Last sync: <b className="text-ink">{device.lastSyncAt ? new Date(device.lastSyncAt).toLocaleString() : "Never"}</b></div>
      </div>

      <MappingsSection device={device} employees={employees} />

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="pill-secondary flex items-center gap-1 px-3 py-2 text-xs" onClick={() => setEditing(true)}><Pencil size={13} /> Edit</button>
        <button className="pill-secondary flex items-center gap-1 px-3 py-2 text-xs" disabled={rotate.isPending} onClick={() => { if (confirm("Rotate the connector token? The connector using the old one will stop syncing until you update its .env.")) rotate.mutate() }}>
          <RefreshCw size={13} /> Rotate token
        </button>
        <CopyButton value={device.id} label="Copy device ID" />
        {device.doorEnabled && <span className="pill-secondary flex items-center gap-1 px-3 py-2 text-xs"><DoorOpen size={13} /> Door enabled</span>}
        <button
          className="ml-auto rounded-xl px-3 py-2 text-xs text-red-600 hover:bg-red-50"
          disabled={remove.isPending}
          onClick={() => { if (confirm(`Delete ${device.name}? Its mappings and stored punches are deleted too.`)) remove.mutate() }}
          aria-label="Delete device"
        >
          <Trash2 size={13} />
        </button>
      </div>
      {(rotate.isError || remove.isError) && <p className="mt-2 text-xs text-chip-pink-fg">{errorText(rotate.error || remove.error, "Action failed")}</p>}
    </div>
  )
}

export default function AttendanceDevices() {
  const { user, organization } = useAuth()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [token, setToken] = useState("")
  const allowed = user?.role === "ADMIN" || user?.role === "CEO" || user?.canManageAttendance

  const { data = [], isLoading } = useQuery({
    queryKey: ["biometric-devices"],
    queryFn: () => api.get("/biometric/devices").then((r) => r.data),
    enabled: !!allowed,
    refetchInterval: 15000,
  })
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-biometric"],
    queryFn: () => api.get("/employees").then((r) => (Array.isArray(r.data) ? r.data : r.data?.data || [])),
    enabled: !!allowed,
  })

  const create = useMutation({
    mutationFn: (payload) => api.post("/biometric/devices", payload).then((r) => r.data),
    onSuccess: (r) => { setToken(r.connectorToken); setShowAdd(false); qc.invalidateQueries({ queryKey: ["biometric-devices"] }) },
  })

  if (!allowed) return <div className="card p-6">You do not have permission to manage biometric devices.</div>

  const serverAddress = organization?.slug ? admsServerAddress(organization.slug) : ""

  return (
    <div>
      <PageHeader title="Attendance Devices" subtitle="Connect biometric terminals and access-control devices for this organization." backTo="/settings" />

      {serverAddress && (
        <div className="card mb-5 p-5">
          <SectionHeader title="Device link (ADMS push)" />
          <p className="text-xs text-muted">
            Enter this on the device under Comm → Cloud Server Setting (ADMS): Enable Domain Name ON, Server Port 443.
            The device's Serial number below must match the one on the device's System Info screen exactly.
            Only use this on a device that belongs to this organization alone — a device can push to one link only.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input readOnly value={serverAddress} className="input min-w-[260px] flex-1 font-mono text-xs" />
            <CopyButton value={serverAddress} />
          </div>
        </div>
      )}

      <div className="mb-5 flex justify-end">
        <button className="pill-accent px-4 py-2 text-sm" onClick={() => { setShowAdd(true); create.reset() }}>+ Add device</button>
      </div>

      {token && (
        <div className="card mb-5 border border-accent/30 p-5">
          <SectionHeader title="Connector token" />
          <p className="text-xs text-muted">Copy this token into the connector's .env (CONNECTOR_TOKEN). It is shown only once.</p>
          <div className="mt-3 flex gap-2">
            <input readOnly value={token} className="input flex-1 font-mono text-xs" />
            <CopyButton value={token} />
          </div>
        </div>
      )}

      {showAdd && (
        <div className="card mb-5 p-6">
          <SectionHeader title="Add biometric device" />
          <DeviceForm
            initial={EMPTY_FORM}
            submitLabel="Create device"
            submitting={create.isPending}
            error={create.isError ? errorText(create.error, "Could not create device") : ""}
            onSubmit={(payload) => create.mutate(payload)}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="card p-6">Loading devices…</div>
      ) : data.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((d) => <DeviceCard key={d.id} device={d} employees={employees} onToken={setToken} />)}
        </div>
      ) : (
        <div className="card p-6 text-sm text-muted">No devices yet. Add one to get a connector token.</div>
      )}
    </div>
  )
}
