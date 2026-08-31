import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import ParticleText from "../components/ParticleText"
import {
  Package,
  Layers,
  ShieldAlert,
  PlusCircle,
  Truck,
  ClipboardList,
  Undo2,
  Wrench,
  UserPlus,
  ArrowUpRight,
  Boxes,
  Laptop2,
  MonitorSmartphone,
  Smartphone,
  Users, CalendarCheck, FolderKanban, Building2, AlertTriangle, Megaphone,
} from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import StatCard from "../components/StatCard"
import IconChip from "../components/ui/IconChip"
import SectionHeader from "../components/ui/SectionHeader"

const ACTIVITY_ICONS = {
  PURCHASED: { icon: PlusCircle, tone: "blue" },
  ASSIGNED: { icon: UserPlus, tone: "green" },
  UNASSIGNED: { icon: Undo2, tone: "slate" },
  REPAIR_STARTED: { icon: Wrench, tone: "orange" },
  REPAIR_COMPLETED: { icon: Wrench, tone: "green" },
  UPGRADED: { icon: ClipboardList, tone: "purple" },
  WARRANTY_EXPIRED: { icon: ShieldAlert, tone: "pink" },
  RETURNED: { icon: Undo2, tone: "slate" },
  DISPOSED: { icon: Truck, tone: "pink" },
  NOTE: { icon: ClipboardList, tone: "yellow" },
}

const CATEGORY_ICON = {
  Laptop: { icon: Laptop2, tone: "blue" },
  Monitor: { icon: MonitorSmartphone, tone: "purple" },
  Phone: { icon: Smartphone, tone: "cyan" },
  Default: { icon: Boxes, tone: "orange" },
}

function formatTime(iso) {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function humanEvent(type) {
  return (type || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function GaugeRadial({ percent = 0, sublabel = "Utilization" }) {
  const ticks = 60
  const activeTicks = Math.round((percent / 100) * ticks)

  return (
    <div className="relative flex flex-col items-center">
      <svg
        width="240"
        height="150"
        viewBox="0 0 240 150"
        className="overflow-visible"
      >
        {Array.from({ length: ticks }).map((_, i) => {
          const angle = Math.PI - (Math.PI * i) / (ticks - 1)
          const cx = 120
          const cy = 130
          const rOuter = 110
          const rInner = 78
          const x1 = cx + rInner * Math.cos(angle)
          const y1 = cy - rInner * Math.sin(angle)
          const x2 = cx + rOuter * Math.cos(angle)
          const y2 = cy - rOuter * Math.sin(angle)
          const active = i < activeTicks

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={
                active
                  ? "var(--accent)"
                  : "var(--border-strong)"
              }
              strokeWidth={active ? 2.2 : 1.5}
              strokeLinecap="round"
              opacity={active ? 0.9 : 0.55}
            />
          )
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center">
        <span
          className="text-3xl font-semibold text-ink"
          style={{ letterSpacing: "-0.02em" }}
        >
          {percent}%
        </span>
        <span className="text-xs text-muted">{sublabel}</span>
      </div>
    </div>
  )
}

function defaultRange() {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - 6)

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export default function Dashboard() {
  const { user } = useAuth()
  const [range, setRange] = useState(defaultRange)

  const [executiveScope, setExecutiveScope] = useState("organization")
  const { data: executive } = useQuery({
    queryKey: ["dashboard-executive", executiveScope],
    queryFn: () => api.get("/dashboard/executive", { params: { scope: executiveScope } }).then((r) => r.data),
    enabled: ["ADMIN", "CEO"].includes(user?.role),
  })
  const { data: anomalies = [] } = useQuery({
    queryKey: ["dashboard-attendance-anomalies"],
    queryFn: () => api.get("/dashboard/attendance-anomalies").then((r) => r.data),
    enabled: ["ADMIN", "CEO"].includes(user?.role),
  })
  const { data: announcements = [] } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => api.get("/dashboard/announcements").then((r) => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => api.get("/dashboard/stats").then((r) => r.data),
  })

  const { data: activity } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => api.get("/dashboard/activity").then((r) => r.data),
  })

  const { data: latestAssets } = useQuery({
    queryKey: ["dashboard-latest-assets"],
    queryFn: () =>
      api.get("/dashboard/latest-assets").then((r) => r.data),
  })

  const { data: tickets } = useQuery({
    queryKey: ["dashboard-tickets"],
    queryFn: () => api.get("/tickets").then((r) => r.data),
  })

  const {
    data: inventoryActivity,
    isFetching: loadingActivity,
    error: inventoryError,
  } = useQuery({
    queryKey: [
      "dashboard-inventory-activity",
      range.start,
      range.end,
    ],
    queryFn: () =>
      api
        .get("/dashboard/inventory-activity", {
          params: {
            start: range.start,
            end: range.end,
          },
        })
        .then((r) => r.data),
    enabled: !!range.start && !!range.end,
  })

  const total = stats?.totalAssets || 0

  const utilization = total
    ? Math.round(
        ((stats?.assignedAssets || 0) / total) * 100
      )
    : 0

  const bars = inventoryActivity?.series || []

  const fallbackBars =
    bars.length === 0 && stats
      ? [
          {
            name: "Current",
            assigned: stats.assignedAssets || 0,
            available: stats.availableAssets || 0,
            repair: stats.assetsUnderRepair || 0,
          },
        ]
      : bars

  const inventoryErrorMessage =
    inventoryError?.response?.data?.error ||
    inventoryError?.message ||
    "Unable to load inventory activity."

  const alerts = [
    stats?.expiringWarranties
      ? {
          tone: "pink",
          icon: ShieldAlert,
          title: "Warranty Alert",
          desc: `${stats.expiringWarranties} assets nearing warranty end`,
        }
      : null,

    stats?.pendingRequests
      ? {
          tone: "yellow",
          icon: ClipboardList,
          title: "Pending Tickets",
          desc: `${stats.pendingRequests} requests need review`,
        }
      : null,

    stats?.availableAssets
      ? {
          tone: "green",
          icon: Package,
          title: "Available Inventory",
          desc: `${stats.availableAssets} assets ready to assign`,
        }
      : null,

    (tickets?.length || 0)
      ? {
          tone: "cyan",
          icon: ClipboardList,
          title: "Open Support",
          desc: `${tickets.length} active tickets in queue`,
        }
      : null,
  ].filter(Boolean)

  const topAssets = (latestAssets || []).slice(0, 3)

  return (
    <div className="space-y-5">
      {["ADMIN", "CEO"].includes(user?.role) && executive && (
        <section className="card overflow-hidden p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Executive overview</p><h2 className="mt-1 text-2xl font-semibold text-ink">Good morning, {user?.name?.split(" ")[0] || "there"}</h2><p className="mt-1 text-sm text-muted">{executiveScope === "company" ? `${executive.mainCompany?.name || "Main Company"} · all organizations` : `${executive.organization?.name || "Current organization"} · selected organization`}</p></div>
            <div className="flex items-center gap-2"><select value={executiveScope} onChange={e=>setExecutiveScope(e.target.value)} className="field min-w-[180px] text-xs font-semibold"><option value="organization">Current organization</option><option value="company">All organizations</option></select></div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[{label:"Employees",value:executive.metrics.employees,icon:Users},{label:"Present today",value:executive.metrics.present,icon:CalendarCheck},{label:"Projects",value:executive.metrics.projects,icon:FolderKanban},{label:"Assets",value:executive.metrics.assets,icon:Package}].map(x=><div key={x.label} className="rounded-2xl bg-surface-2 p-4"><x.icon size={17} className="text-muted"/><p className="mt-3 text-2xl font-semibold text-ink">{x.value}</p><p className="text-xs text-muted">{x.label}</p></div>)}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-border p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-ink">Project status</p><Link to="/projects" className="text-xs font-semibold text-accent">View projects</Link></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div><p className="text-xl font-semibold text-ink">{executive.projects.notStarted}</p><p className="text-[11px] text-muted">Not started</p></div><div><p className="text-xl font-semibold text-ink">{executive.projects.inProgress}</p><p className="text-[11px] text-muted">In progress</p></div><div><p className="text-xl font-semibold text-ink">{executive.projects.completed}</p><p className="text-[11px] text-muted">Completed</p></div></div></div><div className="rounded-2xl border border-border p-4"><p className="text-sm font-semibold text-ink">Attendance watch</p><div className="mt-3 flex flex-wrap gap-2"><span className="rounded-full bg-chip-yellow-bg px-3 py-1.5 text-xs font-semibold text-chip-yellow-fg">{executive.metrics.late} late today</span><span className="rounded-full bg-chip-pink-bg px-3 py-1.5 text-xs font-semibold text-chip-pink-fg">{executive.metrics.missingCheckout} missing check-out</span></div></div></div>
        </section>
      )}
      <section className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col justify-center px-2 sm:px-4">
          <h1
            className="text-[28px] font-semibold leading-tight text-ink"
            style={{ letterSpacing: "-0.03em" }}
          >
            Welcome Back, {user?.name?.split(" ")[0] || "there"} !
          </h1>

          <p className="mt-1.5 text-sm text-muted">
            Here's what's happening with your inventory today
          </p>
        </div>

        <StatCard
          label="Total Assets"
          value={stats?.totalAssets ?? "—"}
          sublabel="From last month"
          icon={Package}
          tone="blue"
          trend={{ value: "12%", direction: "up" }}
        />

        <StatCard
          label="Assigned Assets"
          value={stats?.assignedAssets ?? "—"}
          sublabel={`${utilization}% utilization`}
          icon={Layers}
          tone="purple"
          trend={{ value: "8%", direction: "up" }}
        />

        <StatCard
          label="Warranty Alerts"
          value={stats?.expiringWarranties ?? "—"}
          sublabel="Expiring in 30 days"
          icon={ShieldAlert}
          tone="cyan"
          trend={{ value: "3%", direction: "down" }}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionHeader
            title="Inventory Activity"
            showMenu
            action={
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#F9BD22" }}
                  />
                  Assigned
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#707978" }}
                  />
                  Available
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: "#0058BE" }}
                  />
                  Repair
                </span>

                <div className="flex items-center gap-1.5 rounded-full border border-border-strong px-2 py-1">
                  <input
                    type="date"
                    value={range.start}
                    max={range.end}
                    onChange={(e) =>
                      setRange((r) => ({
                        ...r,
                        start: e.target.value,
                      }))
                    }
                    className="w-[120px] bg-transparent text-[11px] font-medium text-ink outline-none"
                    aria-label="From date"
                  />

                  <span className="text-muted-2">–</span>

                  <input
                    type="date"
                    value={range.end}
                    min={range.start}
                    max={new Date()
                      .toISOString()
                      .slice(0, 10)}
                    onChange={(e) =>
                      setRange((r) => ({
                        ...r,
                        end: e.target.value,
                      }))
                    }
                    className="w-[120px] bg-transparent text-[11px] font-medium text-ink outline-none"
                    aria-label="To date"
                  />
                </div>
              </div>
            }
          />

          <div className="h-64">
            {inventoryError ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                {inventoryErrorMessage}
              </div>
            ) : loadingActivity && bars.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Loading…
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={fallbackBars}
                  margin={{
                    top: 8,
                    right: 8,
                    left: 0,
                    bottom: 0,
                  }}
                >
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 11,
                      fill: "var(--muted)",
                    }}
                  />

                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 11,
                      fill: "var(--muted)",
                    }}
                    tickFormatter={(v) =>
                      v >= 1000 ? `${v / 1000}k` : v
                    }
                    width={40}
                  />

                  <Tooltip
                    cursor={{
                      stroke: "var(--border-strong)",
                      strokeWidth: 1,
                    }}
                    contentStyle={{
                      background: "var(--surface)",
                      border:
                        "1px solid var(--border-strong)",
                      borderRadius: 12,
                      boxShadow: "var(--shadow-card)",
                      fontSize: 12,
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="assigned"
                    stroke="#F9BD22"
                    strokeWidth={2.5}
                    dot={{
                      r: 3,
                      strokeWidth: 0,
                      fill: "#F9BD22",
                    }}
                    activeDot={{ r: 5 }}
                  />

                  <Line
                    type="monotone"
                    dataKey="available"
                    stroke="#707978"
                    strokeWidth={2.5}
                    dot={{
                      r: 3,
                      strokeWidth: 0,
                      fill: "#707978",
                    }}
                    activeDot={{ r: 5 }}
                  />

                  <Line
                    type="monotone"
                    dataKey="repair"
                    stroke="#0058BE"
                    strokeWidth={2.5}
                    dot={{
                      r: 3,
                      strokeWidth: 0,
                      fill: "#0058BE",
                    }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card p-5">
          <SectionHeader title="Utilization" showMenu />

          <div className="flex flex-col items-center pt-2">
            <GaugeRadial
              percent={utilization}
              sublabel="Assignment Rate"
            />
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-sm">
            <div>
              <p className="text-xs text-muted">Assigned</p>
              <p className="font-semibold text-ink">
                {stats?.assignedAssets ?? "—"}
              </p>
            </div>

            <div className="text-right">
              <p className="text-xs text-muted">Available</p>
              <p className="font-semibold text-ink">
                {stats?.availableAssets ?? "—"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <SectionHeader title="Recent Activities" showMenu />

          <ul className="space-y-3">
            {(activity || []).slice(0, 4).map((ev) => {
              const cfg =
                ACTIVITY_ICONS[ev.type] ||
                ACTIVITY_ICONS.NOTE

              return (
                <li
                  key={ev.id}
                  className="flex items-center gap-3"
                >
                  <IconChip
                    icon={cfg.icon}
                    tone={cfg.tone}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {humanEvent(ev.type)}
                    </p>

                    <p className="truncate text-xs text-muted">
                      {ev.asset?.name || "—"}
                    </p>
                  </div>

                  <span className="shrink-0 text-[11px] font-medium text-muted">
                    {formatTime(ev.occurredAt)}
                  </span>
                </li>
              )
            })}

            {(!activity || activity.length === 0) && (
              <li className="text-sm text-muted">
                No recent activity.
              </li>
            )}
          </ul>
        </div>

        <div className="card p-5">
          <SectionHeader title="Top Assigned Assets" showMenu />

          <ul className="space-y-3">
            {topAssets.map((asset) => {
              const cfg =
                CATEGORY_ICON[asset.category] ||
                CATEGORY_ICON.Default

              return (
                <li
                  key={asset.id}
                  className="flex items-center gap-3"
                >
                  <IconChip
                    icon={cfg.icon}
                    tone={cfg.tone}
                    size="md"
                  />

                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/inventory/${asset.id}`}
                      className="block truncate text-sm font-semibold text-ink hover:text-accent"
                    >
                      {asset.name}
                    </Link>

                    <p className="truncate font-mono text-[11px] text-muted">
                      ID:{asset.serialNumber}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-ink">
                      {asset.category || "—"}
                    </p>

                    <p className="text-[11px] text-muted">
                      {asset.assignedTo?.name
                        ? "Assigned"
                        : "Available"}
                    </p>
                  </div>
                </li>
              )
            })}

            {topAssets.length === 0 && (
              <li className="text-sm text-muted">
                No assets yet.
              </li>
            )}
          </ul>
        </div>

        <div className="card p-5">
          <SectionHeader
            title="Alerts & Notifications"
            showMenu
          />

          <ul className="space-y-2">
            {alerts.length === 0 && (
              <li className="text-sm text-muted">
                All clear. No open alerts.
              </li>
            )}

            {alerts.map((a, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 bg-chip-${a.tone}-bg/60`}
              >
                <IconChip
                  icon={a.icon}
                  tone={a.tone}
                  size="sm"
                />

                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-semibold text-chip-${a.tone}-fg`}
                  >
                    {a.title}
                  </p>

                  <p className="truncate text-xs text-muted">
                    {a.desc}
                  </p>
                </div>

                <ArrowUpRight
                  size={15}
                  className="shrink-0 text-muted"
                />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {["ADMIN", "CEO"].includes(user?.role) && (anomalies.length > 0 || announcements.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card p-5"><SectionHeader title="Attendance anomalies" action={<Link to="/attendance" className="text-xs font-semibold text-accent">Open attendance</Link>} /><div className="mt-3 space-y-2">{anomalies.slice(0,4).map(a=><div key={a.id} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3"><IconChip icon={AlertTriangle} tone="orange" size="sm"/><div className="min-w-0"><p className="text-sm font-semibold text-ink">{a.employee?.name}</p><p className="text-xs text-muted">{a.reasons.join(" · ")}</p></div></div>)}</div></div>
          <div className="card p-5"><SectionHeader title="Latest announcements" action={<Link to="/announcements" className="text-xs font-semibold text-accent">View all</Link>} /><div className="mt-3 space-y-2">{announcements.slice(0,4).map(a=><div key={a.id} className="rounded-2xl bg-surface-2 p-3"><div className="flex items-center gap-2"><Megaphone size={14} className="text-muted"/><p className="truncate text-sm font-semibold text-ink">{a.title}</p></div><p className="mt-1 line-clamp-2 text-xs text-muted">{a.body}</p></div>)}</div></div>
        </section>
      )}

      <div
        className="mt-8 overflow-hidden rounded-card"
        style={{ backgroundColor: "var(--ink-strong)" }}
      >
        <ParticleText text="ASSETFLOW" />
      </div>
    </div>
  )
}