import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import {
  Search,
  Users,
  Boxes,
  FolderKanban,
  Ticket,
  Megaphone,
  X,
} from "lucide-react"
import api from "../api/client"

const TYPE_CONFIG = {
  employee: { label: "Employees", icon: Users },
  asset: { label: "Assets", icon: Boxes },
  project: { label: "Projects", icon: FolderKanban },
  ticket: { label: "Tickets", icon: Ticket },
  announcement: { label: "Announcements", icon: Megaphone },
}

export default function GlobalSearch({ className = "" }) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", query],
    queryFn: () => api.get("/search", { params: { q: query.trim() } }).then((r) => r.data),
    enabled: query.trim().length >= 2,
    staleTime: 15000,
  })

  useEffect(() => {
    function handleOutside(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }

    function handleKey(event) {
      if (event.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", handleOutside)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleOutside)
      document.removeEventListener("keydown", handleKey)
    }
  }, [])

  const results = data?.results || []
  const grouped = results.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = []
    acc[item.type].push(item)
    return acc
  }, {})

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <div className="flex h-10 items-center gap-2 rounded-full border border-border bg-surface px-3 shadow-sm focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10">
        <Search size={16} className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search AssetFlow..."
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-2"
          aria-label="Search AssetFlow"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("")
              setOpen(false)
            }}
            className="rounded-full p-1 text-muted hover:bg-surface-2"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,520px)] min-w-[300px] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-card-lg">
          {isFetching && (
            <p className="px-3 py-4 text-sm text-muted">Searching…</p>
          )}

          {!isFetching && results.length === 0 && (
            <div className="px-3 py-5 text-center">
              <p className="text-sm font-medium text-ink">No results found</p>
              <p className="mt-1 text-xs text-muted">Try an employee, asset, project, ticket or announcement.</p>
            </div>
          )}

          {!isFetching && Object.entries(grouped).map(([type, items]) => {
            const config = TYPE_CONFIG[type] || TYPE_CONFIG.asset
            const Icon = config.icon

            return (
              <div key={type} className="mb-2 last:mb-0">
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {config.label}
                </p>
                {items.map((item) => (
                  <Link
                    key={`${type}-${item.id}`}
                    to={item.link}
                    onClick={() => {
                      setOpen(false)
                      setQuery("")
                    }}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-surface-2"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{item.subtitle}</span>
                    </span>
                  </Link>
                ))}
              </div>
            )
          })}

          {results.length > 0 && (
            <p className="border-t border-border px-2.5 pt-2 text-[10px] text-muted">
              Showing the most relevant results
            </p>
          )}
        </div>
      )}
    </div>
  )
}
