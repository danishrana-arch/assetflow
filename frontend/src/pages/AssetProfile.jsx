import { useState } from "react"
import { useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Boxes, Laptop2, MonitorSmartphone, Smartphone, Keyboard, PenLine, Ticket as TicketIcon, UserMinus } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { isManagement } from "../utils/roles"
import StatusBadge from "../components/StatusBadge"
import LifecycleTimeline from "../components/LifecycleTimeline"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import IconChip from "../components/ui/IconChip"
import { FieldValue, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

function categoryIcon(cat) {
  const c = (cat || "").toLowerCase()
  if (c.includes("laptop") || c.includes("desktop")) return { icon: Laptop2, tone: "blue" }
  if (c.includes("monitor")) return { icon: MonitorSmartphone, tone: "purple" }
  if (c.includes("phone")) return { icon: Smartphone, tone: "cyan" }
  if (c.includes("accessor")) return { icon: Keyboard, tone: "yellow" }
  if (c.includes("stationery") || c.includes("stationary")) return { icon: PenLine, tone: "green" }
  return { icon: Boxes, tone: "orange" }
}

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "REPAIR", label: "In Repair" },
  { value: "LOST", label: "Lost" },
  { value: "DISPOSED", label: "Disposed" },
]

export default function AssetProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const canManage = isManagement(user?.role)
  const queryClient = useQueryClient()
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("")

  const { data: asset, isLoading } = useQuery({
    queryKey: ["asset", id],
    queryFn: () => api.get(`/assets/${id}`).then((r) => r.data),
  })

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get("/employees").then((r) => r.data),
    enabled: canManage,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["asset", id] })
    queryClient.invalidateQueries({ queryKey: ["assets"] })
    queryClient.invalidateQueries({ queryKey: ["employees"] })
  }

  const assignAsset = useMutation({
    mutationFn: () => api.post(`/assets/${id}/assign`, { employeeId: selectedEmployeeId }),
    onSuccess: () => { invalidate(); setSelectedEmployeeId("") },
  })

  // Admin can remove an asset from an employee just as easily as they
  // assigned it — same action available here on the asset's own page.
  const unassignAsset = useMutation({
    mutationFn: () =>
      api.post(`/assets/${id}/status`, {
        status: "AVAILABLE",
        eventType: "UNASSIGNED",
        note: `Unassigned from ${asset?.assignedTo?.name || "employee"}`,
      }),
    onSuccess: invalidate,
  })

  const changeStatus = useMutation({
    mutationFn: ({ status, cost }) => api.post(`/assets/${id}/status`, { status, cost, eventType: status === "REPAIR" ? "REPAIR_STARTED" : undefined }),
    onSuccess: invalidate,
  })

  function handleStatusChange(status) {
    if (status === "REPAIR") {
                const cost = window.prompt("Repair cost:")
      if (cost === null) return // cancelled      
      changeStatus.mutate({ status, cost: cost.trim() || undefined })
    } else {
      changeStatus.mutate({ status })
    }
  }
  
  if (isLoading) return <p className="text-sm text-muted">Loading...</p>
  if (!asset) return <p className="text-sm text-muted">Asset not found.</p>

  const { icon, tone } = categoryIcon(asset.category)
  const availableEmployees = (employees || []).filter((e) => e.status !== "LEFT_COMPANY")

  return (
    <div>
      <PageHeader title="Asset Profile" subtitle="Full history and specs for this asset." backTo="/inventory" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Header */}
          <div className="card p-6">
            <div className="flex items-start gap-4">
              <IconChip icon={icon} tone={tone} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
                    {asset.name}
                  </h2>
                  <StatusBadge status={asset.status} />
                </div>
                <p className="mt-0.5 text-sm text-muted">{asset.category || "Uncategorized"}</p>
                <p className="mt-1 font-mono text-xs text-muted-2">ID:{asset.serialNumber}</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <FieldValue label="CPU" value={asset.cpu} />
              <FieldValue label="RAM" value={asset.ram} />
              <FieldValue label="Storage" value={asset.storage} />
              <FieldValue label="Purchase Date" value={asset.purchaseDate && new Date(asset.purchaseDate).toLocaleDateString(undefined, { timeZone: "UTC" })} />
              <FieldValue label="Warranty End" value={asset.warrantyEnd && new Date(asset.warrantyEnd).toLocaleDateString(undefined, { timeZone: "UTC" })} />
              <FieldValue label="Department" value={asset.department?.name} />
            </div>
          </div>

          {/* Assignment & Status (management only) */}
          {canManage && (
            <div className="card p-5">
              <SectionHeader title="Assignment & Status" />

              {asset.assignedTo ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3.5 py-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Assigned to</p>
                    <p className="text-sm font-semibold text-ink">{asset.assignedTo.name}</p>
                  </div>
                  <button
                    onClick={() => unassignAsset.mutate()}
                    disabled={unassignAsset.isPending}
                    className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs text-danger disabled:opacity-60"
                  >
                    <UserMinus size={13} /> {unassignAsset.isPending ? "Removing…" : "Unassign"}
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (selectedEmployeeId) assignAsset.mutate() }}
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                >
                  <SelectField
                    label="Assign to"
                    value={selectedEmployeeId}
                    onChange={(e) => setSelectedEmployeeId(e.target.value)}
                    className="flex-1"
                  >
                    <option value="">Select an employee</option>
                    {availableEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </SelectField>
                  <button
                    type="submit"
                    disabled={!selectedEmployeeId || assignAsset.isPending}
                    className="pill-accent px-4 py-2.5 text-sm disabled:opacity-60"
                  >
                    {assignAsset.isPending ? "Assigning…" : "Assign"}
                  </button>
                </form>
              )}

              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Change status</p>
                <div className="flex flex-wrap gap-2">
                  {STATUS_OPTIONS.filter((s) => s.value !== asset.status).map((s) => (
                    <button
                      key={s.value}
                      onClick={() => handleStatusChange(s.value)}
                      disabled={changeStatus.isPending || (s.value === "AVAILABLE" && !!asset.assignedTo)}
                      title={s.value === "AVAILABLE" && asset.assignedTo ? "Unassign first" : undefined}
                      className="pill-secondary px-3.5 py-1.5 text-xs disabled:opacity-40"
                    >
                      Mark {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Repair History */}
          <div className="card p-5">
            <SectionHeader title="Repair & Support History" />
            <ul className="space-y-2">
              {(asset.tickets || []).map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <IconChip icon={TicketIcon} tone="orange" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{t.subject}</p>
                    <p className="text-xs text-muted">
                      {(t.status || "").replaceAll("_", " ").toLowerCase()} · {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </li>
              ))}
              {asset.tickets?.length === 0 && (
                <EmptyState icon={TicketIcon} title="No tickets" description="No repair or support tickets logged for this asset." />
              )}
            </ul>
          </div>
        </div>

        {/* Timeline */}
        <div className="card p-5">
          <SectionHeader title="Lifecycle Timeline" />
          <LifecycleTimeline events={asset.lifecycleEvents || []} />
        </div>
      </div>
    </div>
  )
}
