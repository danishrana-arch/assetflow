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
  Users,
  CalendarCheck,
  FolderKanban,
  AlertTriangle,
  Megaphone,
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
  const { user } = useAuth()

  const [range, setRange] =
    useState(defaultRange)

  const [executiveScope, setExecutiveScope] =
    useState("organization")


  /* ==========================================================
     ROLE
  ========================================================== */

  const isManagement =
    ["ADMIN", "CEO"].includes(
      user?.role
    )


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
     ATTENDANCE ANOMALIES
  ========================================================== */

  const { data: anomalies = [] } =
    useQuery({
      queryKey: [
        "dashboard-attendance-anomalies",
      ],

      queryFn: () =>
        api
          .get(
            "/dashboard/attendance-anomalies"
          )
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

    tickets?.length
      ? {
          tone: "cyan",
          icon: ClipboardList,
          title: "Open Support",
          desc: `${tickets.length} active tickets in queue`,
        }
      : null,
  ].filter(Boolean)


  const topAssets =
    (latestAssets || []).slice(0, 3)


  /* ==========================================================
     RETURN
  ========================================================== */

  return (
    <div className="w-full space-y-4 overflow-x-hidden sm:space-y-5 lg:space-y-6">

      {/* ======================================================
          DASHBOARD HEADER
      ======================================================= */}

      <section className="card w-full overflow-hidden">
        <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">

          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted sm:text-xs">
              {isManagement
                ? "Executive overview"
                : "Dashboard"}
            </p>

            <h1
              className="mt-1 text-2xl font-semibold leading-tight text-ink sm:text-[30px]"
              style={{
                letterSpacing: "-0.03em",
              }}
            >
              Good morning,{" "}
              {user?.name?.split(" ")[0] ||
                "there"}
            </h1>

            <p className="mt-1.5 max-w-xl text-xs leading-5 text-muted sm:text-sm">
              Here's your overview of what's
              happening across AssetFlow today.
            </p>

            {isManagement &&
              executive && (
                <p className="mt-2 text-[11px] font-medium leading-4 text-muted sm:text-xs">
                  {executiveScope ===
                  "company"
                    ? `${
                        executive
                          .mainCompany
                          ?.name ||
                        "Main Company"
                      } · All organizations`
                    : `${
                        executive
                          .organization
                          ?.name ||
                        "Current organization"
                      } · Current organization`}
                </p>
              )}
          </div>

          {isManagement &&
            executive && (
              <div className="w-full shrink-0 sm:w-auto">
                <select
                  value={
                    executiveScope
                  }
                  onChange={(e) =>
                    setExecutiveScope(
                      e.target.value
                    )
                  }
                  className="field w-full text-xs font-semibold sm:min-w-[190px] sm:w-auto"
                  aria-label="Dashboard organization scope"
                >
                  <option value="organization">
                    Current organization
                  </option>

                  <option value="company">
                    All organizations
                  </option>
                </select>
              </div>
            )}
        </div>
      </section>


    {/* ======================================================
    PRIMARY STATISTICS
====================================================== */}

<section
  className="
    grid
    grid-cols-1
    gap-4
    sm:grid-cols-2
    lg:grid-cols-3
    lg:gap-5
  "
>
  <StatCard
    label="Total Assets"
    value={stats?.totalAssets ?? "—"}
    sublabel="From last month"
    icon={Package}
    tone="blue"
    trend={{
      value: "12%",
      direction: "up",
    }}
  />

  <StatCard
    label="Assigned Assets"
    value={stats?.assignedAssets ?? "—"}
    sublabel={`${utilization}% utilization`}
    icon={Layers}
    tone="purple"
    trend={{
      value: "8%",
      direction: "up",
    }}
  />

  <StatCard
    label="Warranty Alerts"
    value={stats?.expiringWarranties ?? "—"}
    sublabel="Expiring in 30 days"
    icon={ShieldAlert}
    tone="cyan"
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

            {/* Snapshot Header */}
            <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:px-6">

              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  Company snapshot
                </p>

                <p className="mt-0.5 text-xs leading-5 text-muted">
                  Key workforce, project and
                  attendance figures
                </p>
              </div>

              <Link
                to="/projects"
                className="shrink-0 text-xs font-semibold text-accent hover:underline"
              >
                View projects
              </Link>

            </div>


            {/* Snapshot Metrics */}
            <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">

              {/* Employees */}
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5 lg:px-6">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                  <Users
                    size={17}
                    className="text-muted"
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-xl font-semibold text-ink">
                    {executive.metrics
                      ?.employees ?? "—"}
                  </p>

                  <p className="text-xs text-muted">
                    Employees
                  </p>
                </div>

              </div>


              {/* Present */}
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5 lg:px-6">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                  <CalendarCheck
                    size={17}
                    className="text-muted"
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-xl font-semibold text-ink">
                    {executive.metrics
                      ?.present ?? "—"}
                  </p>

                  <p className="text-xs text-muted">
                    Present today
                  </p>
                </div>

              </div>


              {/* Projects */}
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5 lg:px-6">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                  <FolderKanban
                    size={17}
                    className="text-muted"
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-xl font-semibold text-ink">
                    {executive.projects
                      ?.length ??
                      executive.metrics
                        ?.projects ??
                      "—"}
                  </p>

                  <p className="text-xs text-muted">
                    Projects
                  </p>
                </div>

              </div>


              {/* Assets */}
              <div className="flex items-center gap-3 px-4 py-4 sm:px-5 lg:px-6">

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                  <Package
                    size={17}
                    className="text-muted"
                  />
                </div>

                <div className="min-w-0">
                  <p className="text-xl font-semibold text-ink">
                    {executive.metrics
                      ?.assets ?? "—"}
                  </p>

                  <p className="text-xs text-muted">
                    Total assets
                  </p>
                </div>

              </div>

            </div>


            {/* Project Status + Attendance */}
            <div className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:p-5 lg:grid-cols-2 lg:p-6">

              {/* Project Status */}
              <div className="rounded-2xl border border-border p-4 sm:p-5">

                <div className="flex items-start justify-between gap-3">

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      Project status
                    </p>

                    <p className="mt-0.5 text-xs leading-5 text-muted">
                      Current project distribution
                    </p>
                  </div>

                  <Link
                    to="/projects"
                    className="shrink-0 text-xs font-semibold text-accent"
                  >
                    Open
                  </Link>

                </div>


                <div className="mt-4 grid grid-cols-1 gap-2 xs:grid-cols-3 sm:grid-cols-3">

                  <div className="rounded-xl bg-surface-2 px-2 py-3 text-center">
                    <p className="text-xl font-semibold text-ink">
                      {executive.projects
                        ?.notStarted ?? "—"}
                    </p>

                    <p className="mt-0.5 text-[10px] leading-4 text-muted sm:text-[11px]">
                      Not started
                    </p>
                  </div>

                  <div className="rounded-xl bg-surface-2 px-2 py-3 text-center">
                    <p className="text-xl font-semibold text-ink">
                      {executive.projects
                        ?.inProgress ?? "—"}
                    </p>

                    <p className="mt-0.5 text-[10px] leading-4 text-muted sm:text-[11px]">
                      In progress
                    </p>
                  </div>

                  <div className="rounded-xl bg-surface-2 px-2 py-3 text-center">
                    <p className="text-xl font-semibold text-ink">
                      {executive.projects
                        ?.completed ?? "—"}
                    </p>

                    <p className="mt-0.5 text-[10px] leading-4 text-muted sm:text-[11px]">
                      Completed
                    </p>
                  </div>

                </div>

              </div>


              {/* Attendance */}
              <div className="rounded-2xl border border-border p-4 sm:p-5">

                <div>
                  <p className="text-sm font-semibold text-ink">
                    Attendance watch
                  </p>

                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    Items that may need management
                    attention
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">

                  <span className="rounded-full bg-chip-yellow-bg px-3 py-1.5 text-[11px] font-semibold text-chip-yellow-fg sm:text-xs">
                    {executive.metrics
                      ?.late ?? 0}{" "}
                    late today
                  </span>

                  <span className="rounded-full bg-chip-pink-bg px-3 py-1.5 text-[11px] font-semibold text-chip-pink-fg sm:text-xs">
                    {executive.metrics
                      ?.missingCheckout ??
                      0}{" "}
                    missing check-out
                  </span>

                </div>

              </div>

            </div>

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

        </div>

      </section>


      {/* ======================================================
          RECENT ACTIVITY / TOP ASSETS / ALERTS
      ======================================================= */}

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


        {/* Top Assigned Assets */}
        <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

          <SectionHeader
            title="Top Assigned Assets"
            showMenu
          />

          <ul className="mt-4 space-y-3">

            {topAssets.map((asset) => {

              const cfg =
                CATEGORY_ICON[
                  asset.category
                ] ||
                CATEGORY_ICON.Default

              return (
                <li
                  key={asset.id}
                  className="flex min-w-0 items-center gap-3"
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

                    <p className="truncate font-mono text-[10px] text-muted sm:text-[11px]">
                      ID:
                      {asset.serialNumber}
                    </p>

                  </div>

                  <div className="shrink-0 text-right">

                    <p className="max-w-[90px] truncate text-xs font-semibold text-ink sm:max-w-[110px] sm:text-sm">
                      {asset.category ||
                        "—"}
                    </p>

                    <p className="text-[10px] text-muted sm:text-[11px]">
                      {asset.assignedTo
                        ?.name
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
              <li
                key={i}
                className={`flex min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 bg-chip-${a.tone}-bg/60`}
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

              </li>
            ))}

          </ul>

        </div>

      </section>


      {/* ======================================================
          ATTENDANCE ANOMALIES + ANNOUNCEMENTS
      ======================================================= */}

      {isManagement &&
        (anomalies.length > 0 ||
          announcements.length > 0) && (
          <section className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">

            {/* Attendance anomalies */}
            <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

              <SectionHeader
                title="Attendance anomalies"
                action={
                  <Link
                    to="/attendance"
                    className="shrink-0 text-xs font-semibold text-accent"
                  >
                    Open attendance
                  </Link>
                }
              />

              <div className="mt-4 space-y-2">

                {anomalies
                  .slice(0, 4)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="flex min-w-0 items-start gap-3 rounded-2xl bg-surface-2 p-3"
                    >

                      <IconChip
                        icon={AlertTriangle}
                        tone="orange"
                        size="sm"
                      />

                      <div className="min-w-0">

                        <p className="truncate text-sm font-semibold text-ink">
                          {a.employee?.name}
                        </p>

                        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">
                          {a.reasons?.join(
                            " · "
                          )}
                        </p>

                      </div>

                    </div>
                  ))}

                {anomalies.length === 0 && (
                  <p className="text-sm text-muted">
                    No attendance anomalies
                    detected.
                  </p>
                )}

              </div>

            </div>


            {/* Announcements */}
            <div className="card min-w-0 p-4 sm:p-5 lg:p-6">

              <SectionHeader
                title="Latest announcements"
                action={
                  <Link
                    to="/announcements"
                    className="shrink-0 text-xs font-semibold text-accent"
                  >
                    View all
                  </Link>
                }
              />

              <div className="mt-4 space-y-2">

                {announcements
                  .slice(0, 4)
                  .map((a) => (
                    <div
                      key={a.id}
                      className="min-w-0 rounded-2xl bg-surface-2 p-3"
                    >

                      <div className="flex min-w-0 items-center gap-2">

                        <Megaphone
                          size={14}
                          className="shrink-0 text-muted"
                        />

                        <p className="truncate text-sm font-semibold text-ink">
                          {a.title}
                        </p>

                      </div>

                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                        {a.body}
                      </p>

                    </div>
                  ))}

                {announcements.length ===
                  0 && (
                  <p className="text-sm text-muted">
                    No announcements yet.
                  </p>
                )}

              </div>

            </div>

          </section>
        )}


      {/* ======================================================
          ASSETFLOW PARTICLE BANNER
      ======================================================= */}

      <div
        className="
          mt-1
          w-full
          overflow-hidden
          rounded-2xl
          border border-black/5
          shadow-[0_18px_50px_rgba(0,0,0,0.10)]
          dark:border-white/5
          sm:rounded-[26px]
        "
        style={{
          backgroundColor:
            "#050629",
        }}
      >

        <div className="h-[120px] w-full sm:h-[160px] lg:h-[200px]">

          <ParticleText
            text="ASSETFLOW"
            height={200}
            repelRadius={155}
            repelStrength={210}
            ease={0.065}
          />

        </div>

      </div>

    </div>
  )
}