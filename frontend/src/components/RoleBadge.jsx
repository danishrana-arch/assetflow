import { ShieldCheck } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { roleLabel } from "../utils/roles"

export default function RoleBadge({ className = "" }) {
  const { user } = useAuth()
  if (!user?.role) return null

  const label = roleLabel(user.role)

  return (
    <span
      className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold text-ink ${className}`}
      title={`Signed in as ${label}`}
    >
      <ShieldCheck size={14} className="shrink-0 text-accent" />
      {label}
    </span>
  )
}
