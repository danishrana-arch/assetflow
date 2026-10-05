import { useState } from "react"
import { Link } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, ChevronDown, Users, UserCheck, Clock, UserX, Plane, UserMinus, Boxes, FolderKanban, Ticket, ClipboardList } from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"

// CEO dashboard: every company's numbers behind one dropdown — "All
// companies" (totals) or a single company. Data comes from GET
// /organization/comparison (same figures as Organization Comparison; "today"
// is each company's own local day).
const TILES = [
  { key: "employees", label: "Employees", icon: Users, tone: "bg-chip-blue-bg text-chip-blue-fg" },
  { key: "presentToday", label: "Present", icon: UserCheck, tone: "bg-chip-green-bg text-chip-green-fg" },
  { key: "lateToday", label: "Late", icon: Clock, tone: "bg-chip-yellow-bg text-chip-yellow-fg" },
  { key: "absentToday", label: "Absent", icon: UserX, tone: "bg-chip-pink-bg text-chip-pink-fg" },
  { key: "onLeaveToday", label: "On leave", icon: Plane, tone: "bg-chip-purple-bg text-chip-purple-fg" },
  { key: "notMarkedToday", label: "Not marked", icon: UserMinus, tone: "bg-surface-2 text-muted" },
  { key: "assets", label: "Assets", icon: Boxes, tone: "bg-surface-2 text-muted" },
  { key: "activeProjects", label: "Active projects", icon: FolderKanban, tone: "bg-surface-2 text-muted" },
  { key: "openTickets", label: "Open tickets", icon: Ticket, tone: "bg-surface-2 text-muted" },
  { key: "pendingLeave", label: "Pending leave", icon: ClipboardList, tone: "bg-surface-2 text-muted" },
]

export default function CompaniesOverview() {
  const { user, organization, switchOrganization } = useAuth()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState("ALL")
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["organization-comparison"],
    queryFn: () => api.get("/organization/comparison").then((r) => r.data),
    enabled: user?.role === "CEO",
    refetchInterval: 60000,
  })

  if (user?.role !== "CEO" || (!isLoading && rows.length < 2)) return null

  const company = rows.find((r) => r.id === selected)
  const value = (key) => (company ? Number(company[key]) || 0 : rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0))

  async function open(id) {
    queryClient.clear()
    await switchOrganization(id)
  }

  return (
    <section className="card w-full overflow-hidden p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Company overview</h2>
          <p className="text-[11px] text-muted">
            {isLoading
              ? "Loading…"
              : company
                ? `Today at ${company.name} — its own local day.`
                : `Today across all ${rows.length} companies each company's own local day.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="field h-8 appearance-none py-0 pl-9 pr-9 text-xs font-semibold"
              aria-label="Choose a company"
            >
              <option value="ALL">All companies ({rows.length})</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.isHome ? " (yours)" : ""}</option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
          {company && company.id !== organization?.id && (
            <button type="button" onClick={() => open(company.id)} className="pill-accent h-8 px-3 text-xs font-semibold">
              Open {company.name}
            </button>
          )}
          <Link to="/organization-comparison" className="pill-secondary flex h-8 items-center px-3 text-xs">Compare</Link>
        </div>
      </div>

      {/* Compact tiles: icon + number on one line, label under — one row of
          ten on wide screens. */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5 xl:grid-cols-10">
        {TILES.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="min-w-0 rounded-xl border border-border px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tone}`}>
                <Icon size={12} />
              </span>
              <span className="text-base font-semibold leading-none text-ink">{isLoading ? "—" : value(key)}</span>
            </div>
            <p className="mt-1 truncate text-[10px] text-muted">{label}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
