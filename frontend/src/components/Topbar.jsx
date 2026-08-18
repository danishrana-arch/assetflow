import { Link } from "react-router-dom"
import { Bell, Menu } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import Avatar from "./ui/Avatar"

// Desktop navigation now lives entirely in the floating Sidebar pill, per
// the AssetFlow "Executive" design system — this bar only renders on
// mobile, where the sidebar is hidden in favor of the slide-out MobileNav.
export default function Topbar({ onMenuClick }) {
  const { user, organization } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between bg-surface/80 px-4 py-4 backdrop-blur-md lg:hidden">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          aria-label="Open menu"
        >
          <Menu size={19} />
        </button>
        <span className="text-lg font-bold text-ink">{organization?.name || "AssetFlow"}</span>
      </div>
      <div className="flex items-center gap-3">
        <Link
          to="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
        </Link>
        <Link to="/profile">
          <Avatar name={user?.name || "?"} size="sm" />
        </Link>
      </div>
    </header>
  )
}
