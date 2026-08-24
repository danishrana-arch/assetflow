import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, RefreshCw, Copy, PlugZap, DoorOpen, Wifi, WifiOff } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField } from "../components/ui/Field"
import { useAuth } from "../context/AuthContext"

const VENDORS = ["ZKTECO", "HIKVISION", "SUPREMA", "ANVIZ", "ESSL", "HTTP", "CUSTOM"]

export default function AttendanceDevices() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [token, setToken] = useState("")
  const [form, setForm] = useState({ name: "", vendor: "ZKTECO", model: "", serialNumber: "", ipAddress: "", port: 4370, connectionMode: "PULL", doorEnabled: false, unlockSeconds: 5, relayUrl: "" })
  const allowed = user?.role === "ADMIN" || user?.role === "CEO" || user?.canManageAttendance
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric-devices"], queryFn: () => api.get("/biometric/devices").then(r => r.data), enabled: !!allowed, refetchInterval: 15000 })
  const { data: employees = [] } = useQuery({ queryKey: ["employees-biometric"], queryFn: () => api.get("/employees").then(r => Array.isArray(r.data) ? r.data : (r.data?.data || [])), enabled: !!allowed })
  const [mapping, setMapping] = useState({})
  const mapEmployee = useMutation({ mutationFn: ({ id, employeeId, externalUserId }) => api.post(`/biometric/devices/${id}/mappings`, { employeeId, externalUserId }), onSuccess: () => qc.invalidateQueries({ queryKey: ["biometric-devices"] }) })
  const create = useMutation({ mutationFn: () => api.post("/biometric/devices", form).then(r => r.data), onSuccess: r => { setToken(r.connectorToken); setShowAdd(false); qc.invalidateQueries({ queryKey: ["biometric-devices"] }) } })
  const rotate = useMutation({ mutationFn: id => api.post(`/biometric/devices/${id}/rotate-token`).then(r => r.data), onSuccess: r => setToken(r.connectorToken) })
  const remove = useMutation({ mutationFn: id => api.delete(`/biometric/devices/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["biometric-devices"] }) })
  if (!allowed) return <div className="card p-6">You do not have permission to manage biometric devices.</div>
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return <div>
    <PageHeader title="Attendance Devices" subtitle="Connect biometric terminals and access-control devices for this organization." backTo="/settings" />
    <div className="mb-5 flex justify-end"><button className="pill-accent px-4 py-2 text-sm" onClick={() => setShowAdd(true)}>+ Add device</button></div>
    {token && <div className="card mb-5 border border-accent/30 p-5"><SectionHeader title="Connector token" /><p className="text-xs text-muted">Copy this token into the local AssetFlow Attendance Connector. It is shown only once.</p><div className="mt-3 flex gap-2"><input readOnly value={token} className="input flex-1 font-mono text-xs"/><button className="pill-secondary px-3" onClick={() => navigator.clipboard.writeText(token)}><Copy size={15}/></button></div></div>}
    {showAdd && <div className="card mb-5 p-6"><SectionHeader title="Add biometric device"/><div className="grid gap-4 md:grid-cols-2">
      <TextField label="Device name" value={form.name} onChange={e => set("name", e.target.value)} placeholder="Main Office Door"/>
      <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Vendor</label><select className="input w-full" value={form.vendor} onChange={e => set("vendor", e.target.value)}>{VENDORS.map(v => <option key={v}>{v}</option>)}</select></div>
      <TextField label="Model" value={form.model} onChange={e => set("model", e.target.value)} placeholder="F22 / SpeedFace / etc."/>
      <TextField label="Serial number" value={form.serialNumber} onChange={e => set("serialNumber", e.target.value)}/>
      <TextField label="Local IP" value={form.ipAddress} onChange={e => set("ipAddress", e.target.value)} placeholder="192.168.1.201"/>
      <TextField label="Port" type="number" value={form.port} onChange={e => set("port", e.target.value)}/>
      <div><label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Connection</label><select className="input w-full" value={form.connectionMode} onChange={e => set("connectionMode", e.target.value)}><option>PULL</option><option>PUSH</option><option>HTTP</option></select></div>
      <TextField label="Relay URL (optional)" value={form.relayUrl} onChange={e => set("relayUrl", e.target.value)} placeholder="http://192.168.1.50/unlock"/>
      <TextField label="Unlock seconds" type="number" min={1} max={120} value={form.unlockSeconds} onChange={e => set("unlockSeconds", e.target.value)}/>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.doorEnabled} onChange={e => set("doorEnabled", e.target.checked)}/> Unlock door after successful biometric</label>
    </div><div className="mt-5 flex gap-2"><button className="pill-accent px-4 py-2" disabled={create.isPending || !form.name} onClick={() => create.mutate()}>{create.isPending ? "Connecting…" : "Create device"}</button><button className="pill-secondary px-4 py-2" onClick={() => setShowAdd(false)}>Cancel</button></div></div>}
    {isLoading ? <div className="card p-6">Loading devices…</div> : <div className="grid gap-4 lg:grid-cols-2">{data.map(d => <div className="card p-5" key={d.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-ink">{d.name}</h3><p className="mt-1 text-xs text-muted">{d.vendor}{d.model ? ` · ${d.model}` : ""}</p></div><span className={`flex items-center gap-1 text-xs font-medium ${d.lastSeenAt && Date.now()-new Date(d.lastSeenAt).getTime()<120000 ? "text-chip-green-fg" : "text-muted"}`}>{d.lastSeenAt && Date.now()-new Date(d.lastSeenAt).getTime()<120000 ? <><Wifi size={14}/> Online</> : <><WifiOff size={14}/> Offline</>}</span></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted"><div>IP: <b className="text-ink">{d.ipAddress || "—"}</b></div><div>Port: <b className="text-ink">{d.port || "—"}</b></div><div>Mode: <b className="text-ink">{d.connectionMode}</b></div><div>Door: <b className="text-ink">{d.doorEnabled ? `${d.unlockSeconds}s` : "Off"}</b></div></div><div className="mt-4 border-t border-border pt-4">
  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Employee mapping</p>
  <div className="flex flex-wrap gap-2">
    <select className="input min-w-[180px]" value={mapping[d.id]?.employeeId || ""} onChange={e => setMapping(m => ({...m, [d.id]: {...(m[d.id]||{}), employeeId:e.target.value}}))}>
      <option value="">Select employee</option>{employees.filter(e => e.status === "ACTIVE").map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
    </select>
    <input className="input min-w-[140px]" placeholder="Device User ID" value={mapping[d.id]?.externalUserId || ""} onChange={e => setMapping(m => ({...m, [d.id]: {...(m[d.id]||{}), externalUserId:e.target.value}}))}/>
    <button className="pill-secondary px-3 py-2 text-xs" disabled={!mapping[d.id]?.employeeId || !mapping[d.id]?.externalUserId} onClick={() => mapEmployee.mutate({ id:d.id, ...mapping[d.id] })}>Save mapping</button>
  </div>
</div>
<div className="mt-4 flex flex-wrap gap-2"><button className="pill-secondary px-3 py-2 text-xs" onClick={() => rotate.mutate(d.id)}><RefreshCw size={13}/> Rotate token</button><button className="pill-secondary px-3 py-2 text-xs" onClick={() => navigator.clipboard.writeText(d.id)}><PlugZap size={13}/> Copy device ID</button>{d.doorEnabled && <span className="pill-secondary flex items-center gap-1 px-3 py-2 text-xs"><DoorOpen size={13}/> Door enabled</span>}<button className="ml-auto rounded-xl px-3 py-2 text-xs text-red-600 hover:bg-red-50" onClick={() => { if(confirm(`Remove ${d.name}?`)) remove.mutate(d.id) }}><Trash2 size={13}/></button></div></div>)}</div>}
  </div>
}
