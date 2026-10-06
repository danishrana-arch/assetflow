import { Link } from "react-router-dom"
import { ShieldCheck } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { roleLabel } from "../utils/roles"
import Avatar from "./ui/Avatar"

// Top-right header pill: the signed-in person's name, role tag and picture
// (or initial). Clicking it opens their own profile page. Soft frosted glass
// that follows light/dark mode (.glass-chip in styles/index.css).
export default function ProfileBadge({ className = "" }) {
  const { user } = useAuth()
  if (!user) return null

  const role = roleLabel(user.role) || "User"

  return (
    <Link
      to="/profile"
      title="My profile"
      aria-label={`${user.name || "My"} profile`}
      className={`glass-chip flex h-11 min-w-0 max-w-[280px] items-center gap-3 rounded-full py-1 pl-4 pr-1 text-ink hover:scale-[1.02] ${className}`}
    >
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>
          {user.name || "User"}
        </span>
        <span className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent ring-1 ring-accent/20">
          <ShieldCheck size={9} />
          {role}
        </span>
      </span>
      <Avatar name={user.name || "?"} src={user.photoUrl} size="sm" className="ring-2 ring-white/60 dark:ring-white/15" />
    </Link>
  )
}
