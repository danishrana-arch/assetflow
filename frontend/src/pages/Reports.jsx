import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import { Package, ClipboardCheck, ShieldAlert, Ticket as TicketIcon, Wrench } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import IconChip from "../components/ui/IconChip"
import EmptyState from "../components/ui/EmptyState"

const STATUS_META = {
  ASSIGNED: { color: "#0058BE", label: "Assigned" },
  AVAILABLE: { color: "#16A34A", label: "Available" },
  REPAIR: { color: "#E08800", label: "Repair" },
  LOST: { color: "#BA1A1A", label: "Lost" },
  DISPOSED: { color: "#707978", label: "Disposed" },
}

export default function Reports() {
  const { data: assets } = useQuery({
    queryKey: ["assets", "all"],
    queryFn: () => api.get("/assets").then((r) => r.data),
  })
  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.get("/dashboard/stats").then((r) => r.data),
  })
  const { data: repairSpend } = useQuery({
    queryKey: ["repair-spend"],
    queryFn: () => api.get("/dashboard/repair-spend").then((r) => r.data),
  })

  const pieData = useMemo(() => {
    const counts = (assets || []).reduce((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1
      return acc
    }, {})
    return Object.entries(counts).map(([status, value]) => ({ name: status, value }))
  }, [assets])

  const total = pieData.reduce((s, d) => s + d.value, 0)

  return (
    <div>
      <PageHeader title="Reports" subtitle="Snapshot of your inventory distribution and health." backTo="/" />

      <section className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionHeader title="Asset Status Distribution" showMenu />
          <div className="grid gap-6 sm:grid-cols-[1fr_1fr] sm:items-center">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={4}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={STATUS_META[entry.name]?.color || "#707978"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 12,
                      boxShadow: "var(--shadow-card)",
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-2">
              {pieData.map((d) => {
                const meta = STATUS_META[d.name]
                const pct = total ? Math.round((d.value / total) * 100) : 0
                return (
                  <li key={d.name} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta?.color || "#707978" }} />
                    <span className="flex-1 text-sm text-ink">{meta?.label || d.name}</span>
                    <span className="text-xs text-muted">{d.value}</span>
                    <span className="w-10 text-right text-xs font-semibold text-ink">{pct}%</span>
                  </li>
                )
              })}
              {pieData.length === 0 && <li className="text-sm text-muted">No assets yet.</li>}
            </ul>
          </div>
        </div>

        <div className="space-y-3">
          <div className="card p-5">
            <SectionHeader title="Health Snapshot" />
            <div className="space-y-3">
              <MetricRow icon={Package} tone="blue" label="Total assets" value={stats?.totalAssets ?? "—"} />
              <MetricRow icon={ClipboardCheck} tone="purple" label="Assigned" value={stats?.assignedAssets ?? "—"} />
              <MetricRow icon={ShieldAlert} tone="pink" label="Warranty alerts" value={stats?.expiringWarranties ?? "—"} />
              <MetricRow icon={TicketIcon} tone="orange" label="Pending tickets" value={stats?.pendingRequests ?? "—"} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="card p-5">
          <SectionHeader title="Repair Spend by Asset" showMenu />
          {repairSpend?.byAsset?.length > 0 ? (
            <>
              <p className="mb-3 text-2xl font-bold text-ink">PKR {repairSpend.total.toFixed(2)}<span className="ml-1.5 text-xs font-normal text-muted">total logged</span></p>
              <ul className="space-y-2">
                {repairSpend.byAsset.map((a) => (
                  <li key={a.assetId} className="flex items-center gap-3">
                    <IconChip icon={Wrench} tone="orange" size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-2">{a.serialNumber}</p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-warning">PKR {a.total.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState icon={Wrench} title="No repair costs logged yet" description="Costs recorded when marking an asset for repair will show up here." />
          )}
        </div>

        <div className="card p-5">
          <SectionHeader title="Repair Spend by Category" showMenu />
          {repairSpend?.byCategory?.length > 0 ? (
            <ul className="space-y-2">
              {repairSpend.byCategory.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink">{c.category}</span>
                  <span className="text-xs text-muted">{c.count} repair{c.count === 1 ? "" : "s"}</span>
                  <span className="w-20 text-right text-sm font-semibold text-warning">PKR {c.total.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Wrench} title="No repair costs logged yet" description="Break down by category will appear once costs are recorded." />
          )}
        </div>
      </section>
    </div>
  )
}

function MetricRow({ icon, tone, label, value }) {
  return (
    <div className="flex items-center gap-3">
      <IconChip icon={icon} tone={tone} size="sm" />
      <span className="flex-1 text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  )
}
