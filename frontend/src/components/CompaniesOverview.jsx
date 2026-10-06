import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronRight, Boxes, Loader2, X } from "lucide-react"
import { TotalEmployeesIcon, PresentIcon, LateIcon, AbsentIcon, OnLeaveIcon, ActiveProjectsIcon } from "./ui/StatusIcons"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"

// CEO dashboard: every company's numbers behind one dropdown — "All
// companies" (totals) or a single company. Data comes from GET
// /organization/comparison (same figures as Organization Comparison; "today"
// is each company's own local day).
//
// Every tile is a link to the list behind its number, inside that company:
// with one company picked it switches to it (if needed) and opens the list;
// with "All companies" it first shows the per-company breakdown to pick from.
// `to` filters are chosen so the list shows exactly the tile's count
// (attendance: Attendance.jsx FILTERS, today in the company's timezone).
const TILES = [
  { key: "employees", label: "Employees", icon: TotalEmployeesIcon, to: "/employees?status=ACTIVE" },
  { key: "presentToday", label: "Present", icon: PresentIcon, to: "/attendance?status=present" },
  { key: "lateToday", label: "Late", icon: LateIcon, to: "/attendance?status=late" },
  { key: "absentToday", label: "Absent", icon: AbsentIcon, to: "/attendance?status=markedabsent" },
  { key: "onLeaveToday", label: "On leave", icon: OnLeaveIcon, to: "/attendance?status=timeoff" },
  { key: "assets", label: "Assets", icon: Boxes, to: "/inventory?view=all" },
  { key: "activeProjects", label: "Active projects", icon: ActiveProjectsIcon, to: "/projects?status=IN_PROGRESS" },
]

export default function CompaniesOverview() {
  const { user, organization, switchOrganization } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [selected, setSelected] = useState("ALL")
  const [breakdown, setBreakdown] = useState(null) // tile key while the "All companies" picker is open
  const [opening, setOpening] = useState("")
  const [error, setError] = useState("")
  const panelRef = useRef(null)
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["organization-comparison"],
    queryFn: () => api.get("/organization/comparison").then((r) => r.data),
    enabled: user?.role === "CEO",
    refetchInterval: 60000,
  })

  // Close the breakdown on Escape / outside click.
  useEffect(() => {
    if (!breakdown) return undefined
    const onKey = (e) => e.key === "Escape" && setBreakdown(null)
    const onDown = (e) => panelRef.current && !panelRef.current.contains(e.target) && setBreakdown(null)
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    }
  }, [breakdown])

  if (user?.role !== "CEO" || (!isLoading && rows.length < 2)) return null

  const company = rows.find((r) => r.id === selected)
  const value = (key) => (company ? Number(company[key]) || 0 : rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0))
  const tileFor = (key) => TILES.find((t) => t.key === key)

  async function switchTo(id) {
    if (id === organization?.id) return
    // Drop the current company's cached lists before loading the next one.
    queryClient.clear()
    await switchOrganization(id)
  }

  // Switch to the company (if it isn't the current one), then open the list.
  async function openList(companyId, tile) {
    setOpening(`${companyId}:${tile.key}`)
    setError("")
    try {
      await switchTo(companyId)
      setBreakdown(null)
      navigate(tile.to)
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Could not open that company.")
    } finally {
      setOpening("")
    }
  }

  function onTileClick(tile) {
    if (isLoading) return
    if (company) openList(company.id, tile)
    else setBreakdown((current) => (current === tile.key ? null : tile.key))
  }

  const activeTile = breakdown ? tileFor(breakdown) : null

  return (
    <section className="card w-full overflow-hidden p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Company overview</h2>
          <p className="text-[11px] text-muted">
            {isLoading
              ? "Loading…"
              : company
                ? `Today at ${company.name} — its own local day. Click a number to open the list.`
                : `Today across all ${rows.length} companies, each on its own local day. Click a number to see it per company.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <select
              value={selected}
              onChange={(e) => { setSelected(e.target.value); setBreakdown(null) }}
              className="field h-8 appearance-none py-0 pl-3 pr-9 text-xs font-semibold"
              aria-label="Choose a company"
            >
              <option value="ALL">All companies ({rows.length})</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
          </div>
          {company && company.id !== organization?.id && (
            <button type="button" onClick={() => switchTo(company.id).catch((err) => setError(err.message))} className="pill-accent h-8 px-3 text-xs font-semibold">
              Open {company.name}
            </button>
          )}
          <Link to="/organization-comparison" className="pill-secondary flex h-8 items-center px-3 text-xs">Compare</Link>
        </div>
      </div>

      {/* Compact tiles: icon + number on one line, label under — one row of
          eight on wide screens. Each is a button. */}
      <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-7">
        {TILES.map((tile) => {
          const { key, label, icon: Icon } = tile
          const busy = company && opening === `${company.id}:${key}`
          const active = breakdown === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onTileClick(tile)}
              disabled={isLoading || !!opening}
              aria-expanded={company ? undefined : active}
              title={company ? `Open ${label.toLowerCase()} at ${company.name}` : `${label} per company`}
              className={`group min-w-0 rounded-xl border px-2.5 py-2 text-left transition-colors hover:border-accent/50 hover:bg-surface-2 disabled:cursor-default ${
                active ? "border-accent/60 bg-surface-2" : "border-border"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-ink">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={20} />}
                </span>
                <span className="text-base font-semibold leading-none text-ink">{isLoading ? "—" : value(key)}</span>
                <ChevronRight size={12} className="ml-auto shrink-0 text-muted-2 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <p className="mt-1 truncate text-[10px] text-muted">{label}</p>
            </button>
          )
        })}
      </div>

      {error && <p className="mt-2 text-[11px] font-medium text-chip-pink-fg">{error}</p>}

      {/* "All companies": the clicked tile's number per company — pick one to
          switch to it and open the list. */}
      {activeTile && (
        <div ref={panelRef} className="mt-2 rounded-xl border border-border bg-surface-2/60 p-2">
          <div className="mb-1 flex items-center justify-between px-1.5">
            <p className="text-xs font-semibold text-ink">
              {activeTile.label} — {value(activeTile.key)} across {rows.length} companies
            </p>
            <button type="button" onClick={() => setBreakdown(null)} className="rounded-md p-1 text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const busy = opening === `${r.id}:${activeTile.key}`
              return (
                <button
                  key={r.id}
                  type="button"
                  disabled={!!opening}
                  onClick={() => openList(r.id, activeTile)}
                  className="flex min-w-0 items-center gap-2 rounded-lg border border-transparent bg-surface px-2.5 py-2 text-left text-xs hover:border-accent/50 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.name}</span>
                  <span className="font-semibold text-ink">{Number(r[activeTile.key]) || 0}</span>
                  {busy ? <Loader2 size={12} className="animate-spin text-muted" /> : <ChevronRight size={12} className="text-muted-2" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
