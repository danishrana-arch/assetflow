import { useEffect, useRef, useState } from "react"
import { Outlet } from "react-router-dom"
import Sidebar from "../components/Sidebar"
import Topbar from "../components/Topbar"
import MobileNav from "../components/MobileNav"
import OrganizationSwitcher from "../components/OrganizationSwitcher"
import { useAuth } from "../context/AuthContext"
import GlobalSearch from "../components/GlobalSearch"
import NotificationBell from "../components/NotificationBell"
import RoleBadge from "../components/RoleBadge"

// How long the cursor must stay on the sidebar before it (and the page shift
// below) engages — long enough that a quick pass over one icon doesn't
// trigger it, short enough to still feel immediate.
const SIDEBAR_EXPAND_DELAY_MS = 200

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const expandTimer = useRef(null)
  const { user } = useAuth()
  const showCompanySwitcher = ["ADMIN", "CEO", "IT_MANAGER"].includes(user?.role)

  useEffect(() => () => clearTimeout(expandTimer.current), [])

  function handleSidebarEnter() {
    // Skip on touch/no-hover devices so a stray tap can't get "stuck" mid-expand.
    if (typeof window !== "undefined" && window.matchMedia && !window.matchMedia("(hover: hover)").matches) return
    expandTimer.current = setTimeout(() => setSidebarExpanded(true), SIDEBAR_EXPAND_DELAY_MS)
  }

  function handleSidebarLeave() {
    clearTimeout(expandTimer.current)
    setSidebarExpanded(false)
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      <Sidebar expanded={sidebarExpanded} onMouseEnter={handleSidebarEnter} onMouseLeave={handleSidebarLeave} />
      <Topbar onMenuClick={() => setMobileOpen(true)} />
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* z-10: sits intentionally below the sidebar (z-40) so nothing here —
          including the Organization switcher and the search dropdown — can
          ever paint above the sidebar; see Sidebar.jsx for the rest of the
          layering (tooltips at z-50, the sidebar itself at z-40). The
          transform-based nudge is what makes room for the expanded sidebar
          without reserving permanent layout space or reflowing anything.
          Deliberately a partial nudge (56px), not the full 168px width the
          sidebar grows by — shifting the whole page by the full amount
          pushed wide content (the org switcher, wide cards/tables) off the
          right edge on common laptop widths. The glass sidebar is
          translucent, so a modest gap plus slight, intentional overlap
          reads fine and stays "subtle" per the original ask. */}
      <main
        className={`relative z-10 w-full px-3 py-4 transition-transform duration-300 ease-out sm:px-5 sm:py-6 md:px-6 lg:pl-[112px] lg:pr-8 lg:pt-7 ${
          sidebarExpanded ? "lg:translate-x-14" : "lg:translate-x-0"
        }`}
      >
        <div className="mx-auto w-full max-w-[1600px] min-w-0">
          <div className="mb-5 hidden items-center justify-between gap-4 lg:flex">
            <GlobalSearch className="w-full max-w-[430px]" />
            <div className="flex shrink-0 items-center gap-2">
              {showCompanySwitcher && (
                <div className="rounded-2xl border border-border bg-surface/90 p-1.5 shadow-card backdrop-blur-xl">
                  <OrganizationSwitcher />
                </div>
              )}
              <RoleBadge className="border border-border bg-surface/90 shadow-card backdrop-blur-xl" />
              <NotificationBell className="border border-border bg-surface/90 shadow-card backdrop-blur-xl" />
            </div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
