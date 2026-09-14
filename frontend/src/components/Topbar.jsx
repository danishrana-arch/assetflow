import { Link } from "react-router-dom"
import { Menu } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import Avatar from "./ui/Avatar"
import OrganizationSwitcher from "./OrganizationSwitcher"
import NotificationBell from "./NotificationBell"
import GlobalSearch from "./GlobalSearch"

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
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <GlobalSearch className="hidden min-w-0 flex-1 sm:block sm:max-w-[360px]" />
        <NotificationBell />
        <Link to="/profile" aria-label="Open profile">
          <Avatar name={user?.name || "?"} size="sm" />
        </Link>
      </div>
    </header>
  )
}
