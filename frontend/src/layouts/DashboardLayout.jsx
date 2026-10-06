import { useState } from "react"
import { Link, Outlet } from "react-router-dom"
import { Settings as SettingsIcon } from "lucide-react"
import Sidebar from "../components/Sidebar"
import Topbar from "../components/Topbar"
import MobileNav from "../components/MobileNav"
import OrganizationSwitcher from "../components/OrganizationSwitcher"
import { useAuth } from "../context/AuthContext"
import GlobalSearch from "../components/GlobalSearch"
import NotificationBell from "../components/NotificationBell"
import ProfileBadge from "../components/ProfileBadge"
import ThemeToggle from "../components/ThemeToggle"
import { usePageHistoryTracker } from "../utils/pageHistory"

export default function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user } = useAuth()
  const showCompanySwitcher = ["ADMIN", "CEO", "IT_MANAGER"].includes(user?.role)
  // Same rule as App.jsx's RequireOwner on /settings.
  const canOpenSettings = ["ADMIN", "CEO"].includes(user?.role)
  // Feeds every page's back button (components/ui/BackButton.jsx).
  usePageHistoryTracker()

  return (
    <div className="min-h-screen overflow-x-hidden bg-canvas">
      <Sidebar />
      <Topbar onMenuClick={() => setMobileOpen(true)} />
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/* z-10: sits intentionally below the sidebar (z-40) so nothing here —
          including the Organization switcher and the search dropdown — can
          ever paint above the sidebar or its magnified dock icons/labels. */}
      <main className="relative z-10 w-full px-3 py-4 sm:px-5 sm:py-6 md:px-6 lg:pl-[112px] lg:pr-8 lg:pt-7">
        <div className="mx-auto w-full max-w-[1600px] min-w-0">
          <div className="mb-4 hidden items-center justify-between gap-4 lg:flex">
            {/* Compact search, then the notification bell and (for those who
                can open it) a shortcut straight to Settings. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <GlobalSearch compact className="w-full max-w-[300px]" />
              <NotificationBell className="glass-chip h-11 w-11 shrink-0 text-ink" />
              {canOpenSettings && (
                <Link
                  to="/settings"
                  className="glass-chip flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink"
                  aria-label="Settings"
                  title="Settings"
                >
                  <SettingsIcon size={16} />
                </Link>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ThemeToggle />
              {showCompanySwitcher && (
                <OrganizationSwitcher glass />
              )}
              <ProfileBadge />
            </div>
          </div>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
