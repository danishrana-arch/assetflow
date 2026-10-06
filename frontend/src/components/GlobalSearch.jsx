import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "react-router-dom"
import {
  Search,
  Users,
  Boxes,
  FolderKanban,
  Ticket,
  Megaphone,
  X,
  CornerDownLeft,
} from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { searchablePages, matchPages } from "../utils/navItems"

const TYPE_CONFIG = {
  employee: { label: "Employees", icon: Users },
  asset: { label: "Assets", icon: Boxes },
  project: { label: "Projects", icon: FolderKanban },
  ticket: { label: "Tickets", icon: Ticket },
  announcement: { label: "Announcements", icon: Megaphone },
}
const MAX_PAGES = 6

// Searches the pages this user can open (instantly, from the nav list) and,
// from 2 characters, employees / assets / projects / tickets / announcements
// on the server. ↑/↓ move, Enter opens.
// `onNavigate` runs after a result is opened (e.g. to close the mobile menu).
export default function GlobalSearch({ className = "", compact = false, onNavigate }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef(null)
  const listRef = useRef(null)
  const trimmed = query.trim()

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", trimmed],
    queryFn: () => api.get("/search", { params: { q: trimmed } }).then((r) => r.data),
    enabled: trimmed.length >= 2,
    staleTime: 15000,
  })

  const allPages = useMemo(() => searchablePages(user), [user])
  const pages = useMemo(() => matchPages(allPages, trimmed).slice(0, MAX_PAGES), [allPages, trimmed])

  useEffect(() => {
    function handleOutside(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener("mousedown", handleOutside)
    return () => document.removeEventListener("mousedown", handleOutside)
  }, [])

  const results = trimmed.length >= 2 ? data?.results || [] : []
  const grouped = results.reduce((acc, item) => {
    if (!acc[item.type]) acc[item.type] = []
    acc[item.type].push(item)
    return acc
  }, {})

  // One flat list in display order, for keyboard navigation.
  const flat = [
    ...pages.map((page) => ({ key: `page-${page.to}`, link: page.to })),
    ...Object.entries(grouped).flatMap(([type, items]) => items.map((item) => ({ key: `${type}-${item.id}`, link: item.link }))),
  ]
  const activeIndex = Math.min(active, Math.max(flat.length - 1, 0))

  useEffect(() => { setActive(0) }, [trimmed])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  function close() {
    setOpen(false)
    setQuery("")
  }

  function opened() {
    close()
    onNavigate?.()
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") return setOpen(false)
    if (!flat.length) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % flat.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (i - 1 + flat.length) % flat.length)
    } else if (event.key === "Enter" && open) {
      event.preventDefault()
      navigate(flat[activeIndex].link)
      opened()
      event.currentTarget.blur()
    }
  }

  let index = -1
  const rowClass = (i) => `flex items-center gap-3 rounded-xl px-2.5 py-2.5 ${i === activeIndex ? "bg-surface-2" : "hover:bg-surface-2"}`
  const showPanel = open && trimmed.length >= 1
  const searching = isFetching && trimmed.length >= 2

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <div className={`flex items-center gap-2 rounded-full ${compact ? "glass-chip h-11 px-4" : "h-10 border border-border bg-surface px-3 shadow-sm focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/10"}`}>
        <Search size={compact ? 14 : 16} className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={compact ? "Search pages, people…" : "Search pages, people, assets…"}
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none focus-visible:outline-none placeholder:text-muted-2 ${compact ? "text-xs" : "text-sm"}`}
          aria-label="Search pages and records"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
        />
        {query && (
          <button
            type="button"
            onClick={close}
            className="rounded-full p-1 text-muted hover:bg-surface-2"
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          ref={listRef}
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,520px)] min-w-[min(300px,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-card-lg"
        >
          {pages.length > 0 && (
            <div className="mb-2 last:mb-0">
              <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Pages</p>
              {pages.map((page) => {
                index += 1
                const i = index
                const Icon = page.icon
                return (
                  <Link
                    key={`page-${page.to}`}
                    to={page.to}
                    onClick={opened}
                    onMouseEnter={() => setActive(i)}
                    data-active={i === activeIndex}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={rowClass(i)}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{page.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">{page.group}</span>
                    </span>
                    {i === activeIndex && <CornerDownLeft size={13} className="shrink-0 text-muted-2" />}
                  </Link>
                )
              })}
            </div>
          )}

          {Object.entries(grouped).map(([type, items]) => {
            const config = TYPE_CONFIG[type] || TYPE_CONFIG.asset
            const Icon = config.icon
            return (
              <div key={type} className="mb-2 last:mb-0">
                <p className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {config.label}
                </p>
                {items.map((item) => {
                  index += 1
                  const i = index
                  return (
                    <Link
                      key={`${type}-${item.id}`}
                      to={item.link}
                      onClick={opened}
                      onMouseEnter={() => setActive(i)}
                      data-active={i === activeIndex}
                      role="option"
                      aria-selected={i === activeIndex}
                      className={rowClass(i)}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{item.title}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted">{item.subtitle}</span>
                      </span>
                      {i === activeIndex && <CornerDownLeft size={13} className="shrink-0 text-muted-2" />}
                    </Link>
                  )
                })}
              </div>
            )
          })}

          {searching && <p className="px-3 py-3 text-sm text-muted">Searching records…</p>}

          {!searching && flat.length === 0 && (
            <div className="px-3 py-5 text-center">
              <p className="text-sm font-medium text-ink">No results found</p>
              <p className="mt-1 text-xs text-muted">Try a page name, or an employee, asset, project, ticket or announcement.</p>
            </div>
          )}

          {flat.length > 0 && (
            <p className="border-t border-border px-2.5 pt-2 text-[10px] text-muted">
              ↑ ↓ to move · Enter to open · Esc to close
            </p>
          )}
        </div>
      )}
    </div>
  )
}
