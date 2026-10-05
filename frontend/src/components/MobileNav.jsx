import { NavLink } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import api from "../api/client"
import { BellRing, UserCircle, LogOut, X, Sun, Moon } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { navGroups } from "../utils/navItems"
import OrganizationSwitcher from "./OrganizationSwitcher"

function Row({ to, icon: Icon, label, end, onClick, showDot = false }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
          isActive ? "bg-accent text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
        }`
      }
    >
      <span className="relative flex">
        <Icon size={17} />
        {showDot && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
        )}
      </span>
      <span>{label}</span>
    </NavLink>
  )
}

// Same pages, same grouping as the desktop Sidebar (utils/navItems.js).
export default function MobileNav({ open, onClose }) {
  const { user, logout } = useAuth()
  const { mode, toggleMode } = useTheme()
  const isDark = mode === "dark"

  const { data: unreadNotifications } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => api.get("/notifications/unread-count").then((r) => r.data),
    refetchInterval: 15000,
    staleTime: 5000,
    enabled: open,
  })
  const hasUnreadNotifications = Number(unreadNotifications?.count || 0) > 0

  if (!open) return null

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden="true" />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface p-3 shadow-card-lg lg:hidden">
        <div className="mb-4 flex items-center justify-between px-1">
          <span className="text-sm font-semibold text-ink">Menu</span>
          <button onClick={onClose} className="text-muted" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        {["ADMIN", "CEO", "IT_MANAGER"].includes(user?.role) && (
          <div className="mb-3 rounded-2xl border border-border bg-surface-2 p-3">
            <OrganizationSwitcher />
          </div>
        )}
        <nav className="min-h-0 flex-1 overflow-y-auto pr-1">
          {navGroups(user).map((group, index) => (
            <div key={group.label} className={index ? "mt-3" : ""}>
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-2">{group.label}</p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <Row key={item.to} to={item.to} icon={item.icon} label={item.label} end={item.end} onClick={onClose} />
                ))}
              </div>
            </div>
          ))}
          <div className="my-3 divider" />
          <div className="space-y-1">
            <Row to="/notifications" icon={BellRing} label="Notifications" onClick={onClose} showDot={hasUnreadNotifications} />
            <Row to="/profile" icon={UserCircle} label="My Account" onClick={onClose} />
          </div>
        </nav>
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <button
            onClick={toggleMode}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-ink"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDark ? <Sun size={17} /> : <Moon size={17} />} {isDark ? "Light mode" : "Dark mode"}
          </button>
          <button
            onClick={() => { logout(); onClose() }}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted hover:bg-chip-pink-bg hover:text-chip-pink-fg"
          >
            <LogOut size={17} /> Logout
          </button>
        </div>
      </aside>
    </>
  )
}
