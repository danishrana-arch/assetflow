import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import ParticleText from "../components/ParticleText"
import { useTheme } from "../context/ThemeContext"

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
  CalendarDays,
  X,
  Plus,
  Megaphone,
  Info,
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
import AttendanceSnapshot from "../components/AttendanceSnapshot"
import ProjectTracker from "../components/ProjectTracker"
import { canManageInventory } from "../utils/roles"
import IconChip from "../components/ui/IconChip"
import SectionHeader from "../components/ui/SectionHeader"
import DashboardClock, { DashboardSky, greetingFor, useOrgClock } from "../components/DashboardClock"
import { groupLeaveEvents, eventDateLabel } from "../utils/calendarEvents"


/* ============================================================
   ACTIVITY ICONS
============================================================ */

const ACTIVITY_ICONS = {
  PURCHASED: {
    icon: PlusCircle,
    tone: "blue",
  },

  ASSIGNED: {
    icon: UserPlus,
    tone: "green",
  },

  UNASSIGNED: {
    icon: Undo2,
    tone: "slate",
  },

  REPAIR_STARTED: {
    icon: Wrench,
    tone: "orange",
  },

  REPAIR_COMPLETED: {
    icon: Wrench,
    tone: "green",
  },

  UPGRADED: {
    icon: ClipboardList,
    tone: "purple",
  },

  WARRANTY_EXPIRED: {
    icon: ShieldAlert,
    tone: "pink",
  },

  RETURNED: {
    icon: Undo2,
    tone: "slate",
  },

  DISPOSED: {
    icon: Truck,
    tone: "pink",
  },

  NOTE: {
    icon: ClipboardList,
    tone: "yellow",
  },
}


/* ============================================================
   CATEGORY ICONS
============================================================ */

const CATEGORY_ICON = {
  Laptop: {
    icon: Laptop2,
    tone: "blue",
  },

  Monitor: {
    icon: MonitorSmartphone,
    tone: "purple",
  },

  Phone: {
    icon: Smartphone,
    tone: "cyan",
  },

  Default: {
    icon: Boxes,
    tone: "orange",
  },
}


/* ============================================================
   HELPERS
============================================================ */

function formatTime(iso) {
  if (!iso) return ""

  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}


function humanEvent(type) {
  return (type || "")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase())
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


/* ============================================================
   RESPONSIVE UTILIZATION GAUGE
============================================================ */

function GaugeRadial({
  percent = 0,
  sublabel = "Utilization",
}) {
  const ticks = 60
  const activeTicks = Math.round(
    (percent / 100) * ticks
  )

  return (
    <div className="relative flex w-full max-w-[280px] flex-col items-center">
      <svg
        viewBox="0 0 240 150"
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full overflow-visible"
      >
        {Array.from({ length: ticks }).map((_, i) => {
          const angle =
            Math.PI -
            (Math.PI * i) / (ticks - 1)

          const cx = 120
          const cy = 130
          const rOuter = 110
          const rInner = 78

          const x1 =
            cx +
            rInner *
              Math.cos(angle)

          const y1 =
            cy -
            rInner *
              Math.sin(angle)

          const x2 =
            cx +
            rOuter *
              Math.cos(angle)

          const y2 =
            cy -
            rOuter *
              Math.sin(angle)

          const active =
            i < activeTicks

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
              strokeWidth={
                active ? 2.2 : 1.5
              }
              strokeLinecap="round"
              opacity={
                active ? 0.9 : 0.55
              }
            />
          )
        })}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-[7%] flex flex-col items-center">
        <span
          className="text-2xl font-semibold text-ink sm:text-3xl"
          style={{
            letterSpacing: "-0.02em",
          }}
        >
          {percent}%
        </span>

        <span className="text-[11px] text-muted sm:text-xs">
          {sublabel}
        </span>
      </div>
    </div>
  )
}


/* ============================================================
   DASHBOARD
============================================================ */

export default function Dashboard() {
  const { user, organization } = useAuth()
  const { mode: themeMode } = useTheme()
  const queryClient = useQueryClient()
  const clock = useOrgClock(organization?.timezone, 60000)

  const [range, setRange] =
    useState(defaultRange)

  const executiveScope = "organization"
  const [eventRange, setEventRange] = useState("week")
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [showEventForm, setShowEventForm] = useState(false)
  const [eventForm, setEventForm] = useState({
    title: "",
    date: "",
    description: "",
    isAnnual: true,
  })


  /* ==========================================================
     ROLE
  ========================================================== */

  const isManagement = ["ADMIN", "CEO"].includes(user?.role)
  const isIT = user?.role === "IT_MANAGER"
  const isManager = ["ADMIN", "CEO", "HR"].includes(user?.role)
  // Same check as App.jsx's RequireInventoryAccess — only link the asset stat
  // cards for roles that can actually open those pages.
  const canOpenInventory = canManageInventory(user?.role)


  /* ==========================================================
     EXECUTIVE
  ========================================================== */

  const { data: executive } = useQuery({
    queryKey: [
      "dashboard-executive",
      executiveScope,
    ],

    queryFn: () =>
      api
        .get("/dashboard/executive", {
          params: {
            scope: executiveScope,
          },
        })
        .then((r) => r.data),

    enabled: isManagement,
  })



  /* ==========================================================
     ANNOUNCEMENTS
  ========================================================== */

  const { data: announcements = [] } =
    useQuery({
      queryKey: ["announcements"],

      queryFn: () =>
        api
          .get(
            "/dashboard/announcements"
          )
          .then((r) => r.data),
    })


  /* ==========================================================
     STATS
  ========================================================== */

  const { data: stats } = useQuery({
    queryKey: ["dashboard-stats"],

    queryFn: () =>
      api
        .get("/dashboard/stats")
        .then((r) => r.data),
  })


  /* ==========================================================
     ACTIVITY
  ========================================================== */

  const { data: activity } = useQuery({
    queryKey: ["dashboard-activity"],

    queryFn: () =>
      api
        .get("/dashboard/activity")
        .then((r) => r.data),
  })


  /* ==========================================================
     LATEST ASSETS
  ========================================================== */

  const { data: latestAssets } =
    useQuery({
      queryKey: [
        "dashboard-latest-assets",
      ],

      queryFn: () =>
        api
          .get(
            "/dashboard/latest-assets"
          )
          .then((r) => r.data),
    })


  /* ==========================================================
     TICKETS
  ========================================================== */

  const { data: tickets } = useQuery({
    queryKey: ["dashboard-tickets"],

    queryFn: () =>
      api
        .get("/tickets")
        .then((r) => r.data),
  })


  /* ==========================================================
     SMART ALERTS
  ========================================================== */

  const { data: smartAlerts = [] } = useQuery({
    queryKey: ["smart-alerts", user?.id, organization?.id],
    queryFn: () => api.get("/alerts").then((r) => r.data),
    refetchInterval: 30000,
    staleTime: 10000,
  })

  const {
    data: calendarData = { events: [], calendar: [] },
    isLoading: loadingEvents,
  } = useQuery({
    queryKey: ["dashboard-calendar-events", eventRange],
    queryFn: () =>
      api
        .get("/dashboard/events", { params: { range: eventRange } })
        .then((r) => r.data),
  })

  const createEvent = useMutation({
    mutationFn: () =>
      api.post("/dashboard/events", eventForm).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["dashboard-calendar-events"],
      })
      setShowEventForm(false)
      setEventForm({
        title: "",
        date: "",
        description: "",
        isAnnual: true,
      })
    },
  })


  /* ==========================================================
     INVENTORY ACTIVITY
  ========================================================== */

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
        .get(
          "/dashboard/inventory-activity",
          {
            params: {
              start: range.start,
              end: range.end,
            },
          }
        )
        .then((r) => r.data),

    enabled:
      !isIT &&
      !!range.start &&
      !!range.end,
  })


  /* ==========================================================
     CALCULATIONS
  ========================================================== */

  const total =
    stats?.totalAssets || 0

  const utilization = total
    ? Math.round(
        ((stats?.assignedAssets ||
          0) /
          total) *
          100
      )
    : 0

  const bars =
    inventoryActivity?.series || []

  const fallbackBars =
    bars.length === 0 && stats
      ? [
          {
            name: "Current",
            assigned:
              stats.assignedAssets ||
              0,
            available:
              stats.availableAssets ||
              0,
            repair:
              stats.assetsUnderRepair ||
              0,
          },
        ]
      : bars

  const inventoryErrorMessage =
    inventoryError?.response?.data
      ?.error ||
    inventoryError?.message ||
    "Unable to load inventory activity."


  /* ==========================================================
     ALERTS
  ========================================================== */

  const alertIcon = {
    critical: ShieldAlert,
    warning: ClipboardList,
    info: Package,
  }

  const alertTone = {
    critical: "pink",
    warning: "yellow",
    info: "cyan",
  }

  const alerts = smartAlerts.map((item) => ({
    ...item,
    icon: alertIcon[item.severity] || Package,
    tone: alertTone[item.severity] || "cyan",
    desc: item.message,
  }))


  const topAssets =
    (latestAssets || []).slice(0, 3)


  const calendarToday = new Date()
  const calendarYear = calendarToday.getFullYear()
  const calendarMonth = calendarToday.getMonth()
  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay()
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate()
  const calendarCells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]
  const calendarEventsByDate = (calendarData.calendar || []).reduce((acc, event) => {
    if (!event?.date) return acc
    const key = String(event.date).slice(0, 10)
    if (!acc[key]) acc[key] = []
    acc[key].push(event)
    return acc
  }, {})


  /* ==========================================================
     IT MANAGER DASHBOARD
  ========================================================== */

  if (isIT) {
    const openTickets = (tickets || []).filter((ticket) =>
      ["OPEN", "IN_PROGRESS"].includes(ticket.status)
    ).length

    return (
      <div className="w-full space-y-4 overflow-x-hidden sm:space-y-5 lg:space-y-6">
        <section className="card w-full overflow-hidden p-4 sm:p-5 lg:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted sm:text-xs">
            IT operations
          </p>
          <h2 className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-[30px]">
            Welcome back, {user?.name?.split(" ")[0] || "there"}
          </h2>
          <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted sm:text-sm">
            Asset inventory, assignments, requests and support at a glance.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Total Assets" value={stats?.totalAssets ?? "—"} sublabel="All organization assets" icon={Boxes} tone="blue" />
          <StatCard label="Assigned" value={stats?.assignedAssets ?? "—"} sublabel="Currently assigned" icon={UserPlus} tone="green" />
          <StatCard label="Available" value={stats?.availableAssets ?? "—"} sublabel="Ready to assign" icon={Package} tone="cyan" />
          <StatCard label="Under Repair" value={stats?.assetsUnderRepair ?? "—"} sublabel={`${openTickets} open support tickets`} icon={Wrench} tone="orange" />
        </section>

        <section className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
          <div className="card min-w-0 p-4 sm:p-5 lg:p-6">
            <SectionHeader title="Recent Asset Activity" />
            <ul className="mt-4 space-y-3">
              {(activity || []).slice(0, 6).map((ev) => {
                const cfg = ACTIVITY_ICONS[ev.type] || ACTIVITY_ICONS.NOTE
                return (
                  <li key={ev.id} className="flex min-w-0 items-center gap-3">
                    <IconChip icon={cfg.icon} tone={cfg.tone} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{humanEvent(ev.type)}</p>
                      <p className="truncate text-xs text-muted">{ev.asset?.name || "—"}</p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted">{formatTime(ev.occurredAt)}</span>
                  </li>
                )
              })}
              {(!activity || activity.length === 0) && (
                <li className="text-sm text-muted">No recent asset activity.</li>
              )}
            </ul>
          </div>

          <div className="card min-w-0 p-4 sm:p-5 lg:p-6">
            <SectionHeader title="Latest Assets" />
            <ul className="mt-4 space-y-3">
              {topAssets.map((asset) => {
                const cfg = CATEGORY_ICON[asset.category] || CATEGORY_ICON.Default
                return (
                  <li key={asset.id} className="flex min-w-0 items-center gap-3">
                    <IconChip icon={cfg.icon} tone={cfg.tone} size="md" />
                    <div className="min-w-0 flex-1">
                      <Link to={`/inventory/${asset.id}`} className="block truncate text-sm font-semibold text-ink hover:text-accent">{asset.name}</Link>
                      <p className="truncate font-mono text-[11px] text-muted">ID:{asset.serialNumber}</p>
                    </div>
                    <span className="shrink-0 text-right text-xs font-medium text-muted">{asset.assignedTo?.name ? "Assigned" : "Available"}</span>
                  </li>
                )
              })}
              {topAssets.length === 0 && <li className="text-sm text-muted">No assets yet.</li>}
            </ul>
          </div>
        </section>
      </div>
    )
  }


  /* ==========================================================
     RETURN
  ========================================================== */

  return (
    <div className="w-full space-y-4 overflow-x-hidden sm:space-y-5 lg:space-y-6">

      {/* ======================================================
          DASHBOARD HEADER
      ======================================================= */}

      <div className="glass-scene w-full">
      {/* Coloured light behind the pane — what the glass frosts and bends. */}
      <div className="glass-backdrop" aria-hidden="true">
        <span className="b1" /><span className="b2" /><span className="b3" /><span className="b4" />
      </div>
      <section
        className="glass-panel w-full overflow-hidden"
        onMouseMove={(e) => {
          // Moves the soft shine (.glass-glow) to the cursor.
          const el = e.currentTarget
          const r = el.getBoundingClientRect()
          el.style.setProperty("--gx", `${e.clientX - r.left}px`)
          el.style.setProperty("--gy", `${e.clientY - r.top}px`)
        }}
      >
        <div className="glass-glow" aria-hidden="true" />
        <div className="relative z-[2] flex flex-col gap-4 p-4 sm:gap-5 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6 lg:pr-48">

          <div className="min-w-0 pr-12 lg:pr-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted sm:text-xs">
              {isManagement
                ? "Executive overview"
                : user?.role === "IT_MANAGER"
                  ? "IT operations"
                  : "Dashboard"}
            </p>

            <h1
              className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-[30px]"
              style={{
                letterSpacing: "-0.03em",
              }}
            >
              {greetingFor(clock.hour24)},{" "}
              {user?.name?.split(" ")[0] ||
                "there"}
            </h1>

            <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted sm:text-sm">
              {user?.role === "IT_MANAGER"
                ? "Monitor inventory, assigned assets, requests, and support activity."
                : "Here's your overview of what's happening across ManagementDock today."}
            </p>

            {isManagement &&
              executive && (
                <p className="mt-2 text-[11px] font-medium leading-4 text-muted sm:text-xs">
                  {executive.organizations?.[0]?.name ||
                    organization?.name ||
                    "Your organization"}
                </p>
              )}
          </div>

          <DashboardClock timeZone={organization?.timezone} />
        </div>

        {/* Centred on the bottom-right corner, so it rises out of the corner
            with only its upper-left quarter showing. */}
        <DashboardSky
          timeZone={organization?.timezone}
          className="pointer-events-none absolute bottom-0 right-0 z-[3] h-56 w-56 translate-x-1/2 translate-y-1/2 lg:h-[460px] lg:w-[460px]"
        />
      </section>
      </div>


      {/* ======================================================
          PRIMARY STATISTICS
      ======================================================= */}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">

        <StatCard
          label="Total Assets"
          value={
            stats?.totalAssets ?? "—"
          }
          sublabel="From last month"
          icon={Package}
          tone="blue"
          to={canOpenInventory ? "/inventory?view=all" : undefined}
          trend={{
            value: "12%",
            direction: "up",
          }}
        />

        <StatCard
          label="Assigned Assets"
          value={
            stats?.assignedAssets ?? "—"
          }
          sublabel={`${utilization}% utilization`}
          icon={Layers}
          tone="purple"
          to={canOpenInventory ? "/assignments" : undefined}
          trend={{
            value: "8%",
            direction: "up",
          }}
        />

        <StatCard
          label="Warranty Alerts"
          value={
            stats?.expiringWarranties ??
            "—"
          }
          sublabel="Expiring in 30 days"
          icon={ShieldAlert}
          tone="cyan"
          to={canOpenInventory ? "/inventory?warranty=expiring" : undefined}
          trend={{
            value: "3%",
            direction: "down",
          }}
        />

      </section>


      {/* ======================================================
          EXECUTIVE SNAPSHOT
      ======================================================= */}

      {isManagement &&
        executive && (
          <section className="card w-full overflow-hidden">

            <AttendanceSnapshot timeZone={organization?.timezone}>

              {/* Latest announcements — sits under the stat tiles in the left column */}
              <div className="rounded-2xl border border-border p-4 sm:p-5">

              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    Latest announcements
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    Recent company and department updates
                  </p>
                </div>

                <Link
                  to="/announcements"
                  className="shrink-0 text-xs font-semibold text-accent"
                >
                  View all
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {announcements.slice(0, 4).map((a) => (
                  <div key={a.id} className="min-w-0 rounded-2xl bg-surface-2 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Megaphone size={14} className="shrink-0 text-muted" />
                      <p className="truncate text-sm font-semibold text-ink">
                        {a.title}
                      </p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                      {a.body}
                    </p>
                  </div>
                ))}

                {announcements.length === 0 && (
                  <p className="text-sm text-muted">
                    No announcements yet.
                  </p>
                )}
              </div>

              </div>
            </AttendanceSnapshot>

          </section>
        )}


      {/* ======================================================
          INVENTORY ACTIVITY + UTILIZATION
      ======================================================= */}

      <section className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-3">

        {/* Inventory Activity */}
        <div className="card min-w-0 overflow-hidden p-4 sm:p-5 lg:p-6 xl:col-span-2">

          <SectionHeader
            title="Inventory Activity"
            showMenu
            action={
              <div className="flex w-full flex-wrap items-center gap-2 text-[11px] text-muted sm:w-auto sm:gap-3 sm:text-xs">

                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        "#F9BD22",
                    }}
                  />
                  Assigned
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        "#707978",
                    }}
                  />
                  Available
                </span>

                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        "#0058BE",
                    }}
                  />
                  Repair
                </span>

                <div className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border-strong px-2 py-1">

                  <input
                    type="date"
                    value={range.start}
                    max={range.end}
                    onChange={(e) =>
                      setRange((r) => ({
                        ...r,
                        start:
                          e.target.value,
                      }))
                    }
                    className="w-[105px] min-w-0 bg-transparent text-[10px] font-medium text-ink outline-none sm:w-[120px] sm:text-[11px]"
                    aria-label="From date"
                  />

                  <span className="shrink-0 text-muted-2">
                    –
                  </span>

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
                        end:
                          e.target.value,
                      }))
                    }
                    className="w-[105px] min-w-0 bg-transparent text-[10px] font-medium text-ink outline-none sm:w-[120px] sm:text-[11px]"
                    aria-label="To date"
                  />

                </div>

              </div>
            }
          />


          {/* Chart */}
          <div className="mt-2 h-[230px] w-full min-w-0 sm:h-64">

            {inventoryError ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                {inventoryErrorMessage}
              </div>
            ) : loadingActivity &&
              bars.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                Loading…
              </div>
            ) : (
              <ResponsiveContainer
                width="100%"
                height="100%"
              >
                <LineChart
                  data={fallbackBars}
                  margin={{
                    top: 8,
                    right: 8,
                    left: -8,
                    bottom: 0,
                  }}
                >

                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 10,
                      fill: "var(--muted)",
                    }}
                    minTickGap={12}
                  />

                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fontSize: 10,
                      fill: "var(--muted)",
                    }}
                    tickFormatter={(v) =>
                      v >= 1000
                        ? `${v / 1000}k`
                        : v
                    }
                    width={36}
                  />

                  <Tooltip
                    cursor={{
                      stroke:
                        "var(--border-strong)",
                      strokeWidth: 1,
                    }}
                    contentStyle={{
                      background:
                        "var(--surface)",
                      border:
                        "1px solid var(--border-strong)",
                      borderRadius: 12,
                      boxShadow:
                        "var(--shadow-card)",
                      fontSize: 12,
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="assigned"
                    stroke="#F9BD22"
                    strokeWidth={2.5}
                    strokeDasharray="6 6"
                    dot={{
                      r: 2.5,
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
                    strokeDasharray="3 5"
                    dot={{
                      r: 2.5,
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
                    strokeDasharray="10 5"
                    dot={{
                      r: 2.5,
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


        {/* Utilization */}
        <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

          <SectionHeader
            title="Utilization"
            showMenu
          />

          <div className="flex w-full justify-center pt-2 sm:pt-4">

            <GaugeRadial
              percent={utilization}
              sublabel="Assignment Rate"
            />

          </div>

          <div className="mt-2 flex items-center justify-between gap-4 border-t border-border pt-4 text-sm">

            <div className="min-w-0">
              <p className="text-[11px] text-muted sm:text-xs">
                Assigned
              </p>

              <p className="mt-0.5 font-semibold text-ink">
                {stats?.assignedAssets ??
                  "—"}
              </p>
            </div>

            <div className="min-w-0 text-right">
              <p className="text-[11px] text-muted sm:text-xs">
                Available
              </p>

              <p className="mt-0.5 font-semibold text-ink">
                {stats?.availableAssets ??
                  "—"}
              </p>
            </div>

          </div>

          {/* What this card measures — same formula as `utilization` above. */}
          <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-4 text-muted">
            <Info size={12} className="mt-0.5 shrink-0" />
            <span>
              Share of your organization&apos;s assets currently assigned to
              employees: {stats?.assignedAssets ?? "—"} assigned out of{" "}
              {stats?.totalAssets ?? "—"} total.
            </span>
          </p>

        </div>

      </section>


      {/* ======================================================
          RECENT ACTIVITY / TOP ASSETS / ALERTS
      ======================================================= */}

      {/* ======================================================
          CALENDAR / EVENTS
      ======================================================= */}
      <section className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,1fr)]">
        <div className="card min-w-0 overflow-hidden p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Upcoming events</p>
              <p className="mt-0.5 text-xs leading-5 text-muted">Birthdays, deadlines, holidays, annual events and employee leave.</p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <div className="flex rounded-full border border-border-strong p-0.5">
                {[['week','This week'],['month','This month']].map(([value,label]) => (
                  <button key={value} type="button" onClick={() => setEventRange(value)} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${eventRange === value ? 'bg-accent text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              {isManager && (
                <button type="button" onClick={() => setShowEventForm((v) => !v)} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <Plus size={12} /> Add event
                </button>
              )}
            </div>
          </div>

          {showEventForm && isManager && (
            <form onSubmit={(e) => { e.preventDefault(); if (eventForm.title.trim() && eventForm.date) createEvent.mutate() }} className="mt-4 grid grid-cols-1 gap-2 rounded-2xl border border-border bg-surface-2 p-3 sm:grid-cols-2">
              <input className="field min-w-0" placeholder="Event title" value={eventForm.title} onChange={(e) => setEventForm((v) => ({ ...v, title: e.target.value }))} required />
              <input className="field min-w-0" type="date" value={eventForm.date} onChange={(e) => setEventForm((v) => ({ ...v, date: e.target.value }))} required />
              <input className="field min-w-0 sm:col-span-2" placeholder="Details (optional)" value={eventForm.description} onChange={(e) => setEventForm((v) => ({ ...v, description: e.target.value }))} />
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={eventForm.isAnnual} onChange={(e) => setEventForm((v) => ({ ...v, isAnnual: e.target.checked }))} /> Repeat every year</label>
              <div className="flex justify-start sm:justify-end"><button type="submit" disabled={createEvent.isPending} className="pill-accent px-4 py-2 text-xs">{createEvent.isPending ? 'Saving…' : 'Save event'}</button></div>
            </form>
          )}

          <div className="mt-4 space-y-2">
            {loadingEvents && <p className="text-sm text-muted">Loading events…</p>}
            {!loadingEvents && (calendarData.events || []).length === 0 && <p className="text-sm text-muted">No events in this period.</p>}
            {groupLeaveEvents(calendarData.events || []).map((event) => (
              <button key={event.id} type="button" onClick={() => setSelectedEvent(event)} className="flex w-full min-w-0 items-start gap-3 rounded-2xl bg-surface-2 p-3 text-left hover:bg-surface-2/70">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-muted"><CalendarDays size={15} /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{event.title}</p><p className="mt-0.5 truncate text-xs text-muted">{eventDateLabel(event)} · {(event.type || 'EVENT').replaceAll('_',' ')}</p></div>
                <span className="shrink-0 text-[11px] font-semibold text-accent">View</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card min-w-0 overflow-hidden p-4 sm:p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold text-ink">Calendar</p><p className="truncate text-xs text-muted">{calendarToday.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</p></div><CalendarDays size={17} className="shrink-0 text-muted" /></div>
          <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-muted">{['S','M','T','W','T','F','S'].map((d,i)=><span key={i}>{d}</span>)}</div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarCells.map((day,index) => {
              if (!day) return <span key={index} className="h-8 sm:h-9" />
              const key = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const dayEvents = calendarEventsByDate[key] || []
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => dayEvents[0] && setSelectedEvent(dayEvents[0])}
                  className={`flex min-w-0 min-h-[52px] flex-col items-center justify-start rounded-lg px-0.5 py-1 text-[10px] sm:min-h-[58px] sm:text-xs ${dayEvents.length ? 'bg-accent/10 font-semibold text-accent' : 'text-ink hover:bg-surface-2'}`}
                  title={dayEvents.map((e) => e.title).join(' · ')}
                >
                  <span className="leading-4">{day}</span>
                  {dayEvents.length > 0 && (
                    <span className="mt-0.5 w-full truncate px-0.5 text-[8px] font-medium leading-3 text-accent sm:text-[9px]">
                      {dayEvents[0].title}
                      {dayEvents.length > 1 ? ` +${dayEvents.length - 1}` : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="mt-4 space-y-2 border-t border-border pt-3">
            {groupLeaveEvents((calendarData.calendar || []).filter((e) => e.type === 'EMPLOYEE_LEAVE')).slice(0,3).map((e) => (
              <button key={e.id} type="button" onClick={() => setSelectedEvent(e)} className="flex w-full min-w-0 items-center gap-2 text-left text-xs text-muted"><span className="h-2 w-2 shrink-0 rounded-full bg-accent" /><span className="truncate"><span className="font-semibold text-ink">{e.employeeName}</span> is on leave · {eventDateLabel(e, { month: 'short', day: 'numeric' })}</span></button>
            ))}
          </div>
        </div>
      </section>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-surface p-4 shadow-xl sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{(selectedEvent.type || 'EVENT').replaceAll('_',' ')}</p><h3 className="mt-1 break-words text-lg font-semibold text-ink">{selectedEvent.title}</h3></div><button type="button" onClick={() => setSelectedEvent(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"><X size={14} /></button></div>
            <p className="mt-4 text-sm text-muted">{eventDateLabel(selectedEvent, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
            {selectedEvent.description && <p className="mt-3 break-words rounded-2xl bg-surface-2 p-3 text-sm leading-6 text-ink">{selectedEvent.description}</p>}
            {selectedEvent.employeeName && <p className="mt-3 text-xs text-muted">Employee: <span className="font-semibold text-ink">{selectedEvent.employeeName}</span></p>}
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 xl:grid-cols-3">

        {/* Recent Activities */}
        <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

          <SectionHeader
            title="Recent Activities"
            showMenu
          />

          <ul className="mt-4 space-y-3">

            {(activity || [])
              .slice(0, 4)
              .map((ev) => {

                const cfg =
                  ACTIVITY_ICONS[
                    ev.type
                  ] ||
                  ACTIVITY_ICONS.NOTE

                return (
                  <li
                    key={ev.id}
                    className="flex min-w-0 items-center gap-3"
                  >

                    <IconChip
                      icon={cfg.icon}
                      tone={cfg.tone}
                      size="md"
                    />

                    <div className="min-w-0 flex-1">

                      <p className="truncate text-sm font-semibold text-ink">
                        {humanEvent(
                          ev.type
                        )}
                      </p>

                      <p className="truncate text-xs text-muted">
                        {ev.asset?.name ||
                          "—"}
                      </p>

                    </div>

                    <span className="shrink-0 text-[10px] font-medium text-muted sm:text-[11px]">
                      {formatTime(
                        ev.occurredAt
                      )}
                    </span>

                  </li>
                )
              })}

            {(!activity ||
              activity.length === 0) && (
              <li className="text-sm text-muted">
                No recent activity.
              </li>
            )}

          </ul>

        </div>


        {/* Project Tracker (replaced "Top Assigned Assets") */}
        <ProjectTracker />


        {/* Alerts */}
        <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

          <SectionHeader
            title="Alerts & Notifications"
            showMenu
          />

          <ul className="mt-4 space-y-2">

            {alerts.length === 0 && (
              <li className="text-sm text-muted">
                All clear. No open alerts.
              </li>
            )}

            {alerts.map((a, i) => (
              <Link
                key={i}
                to={a.link || "/notifications"}
                className={`flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 bg-chip-${a.tone}-bg/60 transition-colors hover:bg-chip-${a.tone}-bg`}
              >

                <IconChip
                  icon={a.icon}
                  tone={a.tone}
                  size="sm"
                />

                <div className="min-w-0 flex-1">

                  <p
                    className={`truncate text-sm font-semibold text-chip-${a.tone}-fg`}
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

              </Link>
            ))}

          </ul>

        </div>

      </section>


      {/* ======================================================
          MANAGEMENTDOCK PARTICLE BANNER
      ======================================================= */}

      {/* Same treatment as the Employee Profile footer: no background card,
          black dots in light mode / white in dark mode, yellow accents in
          both. The canvas's touch-none is overridden so swiping over it
          still scrolls on phones. */}
      <div
        aria-hidden="true"
        className="mt-8 h-[155px] w-full select-none overflow-hidden sm:h-[170px] [&_canvas]:touch-auto"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
        }}
      >
        <ParticleText
          text={(organization?.name && organization.name.trim() ? organization.name : "MANAGEMENTDOCK").toUpperCase()}
          height={170}
          background="transparent"
          dotColor={themeMode === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(17, 17, 17, 0.85)"}
          accentColor="rgba(211, 151, 0, 0.9)"
          repelRadius={140}
          repelStrength={210}
          ease={0.065}
        />
      </div>

    </div>
  )
}
