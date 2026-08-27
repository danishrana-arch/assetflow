import { Link } from "react-router-dom"
import { Bell, Menu } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import Avatar from "./ui/Avatar"
import OrganizationSwitcher from "./OrganizationSwitcher"

export default function Topbar({ onMenuClick }) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-border bg-surface/90 px-3 py-3 backdrop-blur-md lg:hidden sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onMenuClick}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          aria-label="Open menu"
        >
          <Menu size={19} />
        </button>
        <div className="min-w-0">
          <OrganizationSwitcher compact />
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          to="/notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
        </Link>
        <Link to="/profile" aria-label="Open profile">
          <Avatar name={user?.name || "?"} size="sm" />
        </Link>
      </div>
    </header>
  )
}
