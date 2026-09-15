import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, MapPin, Plus, Save, Users } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import PageHeader from "../components/ui/PageHeader"
import EmptyState from "../components/ui/EmptyState"

export default function AttendanceSites() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canManage = ["ADMIN", "CEO", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "MANAGER"].includes(user?.role)
  const [form, setForm] = useState({ name: "", address: "", latitude: "", longitude: "", radiusMeters: 250, geofenceMode: "WARNING", timezone: "" })
  const [error, setError] = useState("")

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ["attendance-sites"],
    queryFn: () => api.get("/attendance-sites").then((r) => r.data),
    enabled: canManage,
  })

  const create = useMutation({
    mutationFn: () => api.post("/attendance-sites", form),
    onSuccess: () => {
      setForm({ name: "", address: "", latitude: "", longitude: "", radiusMeters: 250, geofenceMode: "WARNING", timezone: "" })
      setError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-sites"] })
    },
    onError: (err) => setError(err.response?.data?.error || "Could not create site"),
  })

  if (!canManage) return <EmptyState title="Site management is restricted" description="Contact your attendance administrator." />

  return (
    <div>
      <PageHeader title="Attendance Sites" subtitle="Manage project sites, geofences and workforce locations." backTo="/attendance" />

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Plus size={17} className="text-accent" />
            <h2 className="text-sm font-semibold text-ink">Add site</h2>
          </div>
          <div className="space-y-3">
            {[
              ["name", "Site name", "text"],
              ["address", "Address", "text"],
              ["latitude", "Latitude", "number"],
              ["longitude", "Longitude", "number"],
              ["radiusMeters", "Geofence radius (meters)", "number"],
              ["timezone", "Timezone (optional)", "text"],
            ].map(([key, label, type]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="field w-full"
                  placeholder={key === "latitude" ? "e.g. 31.5204" : key === "longitude" ? "e.g. 74.3587" : ""}
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Geofence mode</span>
              <select value={form.geofenceMode} onChange={(e) => setForm((f) => ({ ...f, geofenceMode: e.target.value }))} className="field w-full">
                <option value="WARNING">Warning</option>
                <option value="STRICT">Strict</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </label>
            {error && <div className="rounded-2xl bg-chip-pink-bg px-3 py-2 text-xs text-chip-pink-fg">{error}</div>}
            <button onClick={() => create.mutate()} disabled={create.isPending} className="pill-accent flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-50">
              <Save size={14} /> {create.isPending ? "Creating…" : "Create site"}
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {isLoading && <p className="text-sm text-muted">Loading sites…</p>}
          {sites.map((site) => (
            <div key={site.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink"><Building2 size={16} /> {site.name}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><MapPin size={12} /> {site.address || "No address"}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${site.active ? "bg-chip-green-bg text-chip-green-fg" : "bg-surface-2 text-muted"}`}>{site.active ? "Active" : "Inactive"}</span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Coordinates</p><p className="mt-1 text-xs font-semibold text-ink">{Number(site.latitude).toFixed(6)}, {Number(site.longitude).toFixed(6)}</p></div>
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Radius</p><p className="mt-1 text-xs font-semibold text-ink">{site.radiusMeters}m</p></div>
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Employees</p><p className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink"><Users size={12} /> {site.employeeCount || 0}</p></div>
                <div className="rounded-2xl bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wide text-muted">Manager</p><p className="mt-1 text-xs font-semibold text-ink">{site.managerName || "Unassigned"}</p></div>
              </div>
            </div>
          ))}
          {!isLoading && sites.length === 0 && <EmptyState title="No attendance sites yet" description="Create your first project or office site." />}
        </div>
      </div>
    </div>
  )
}
