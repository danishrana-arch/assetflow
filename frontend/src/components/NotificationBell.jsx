import { useQuery } from "@tanstack/react-query"
import { Bell } from "lucide-react"
import { Link } from "react-router-dom"
import api from "../api/client"

export default function NotificationBell({ className = "" }) {
  const { data } = useQuery({
    queryKey: ["notifications-unread-count"],
    queryFn: () => api.get("/notifications/unread-count").then((r) => r.data),
    refetchInterval: 15000,
    staleTime: 5000,
  })

  const hasUnread = Number(data?.count || 0) > 0

  return (
    <Link
      to="/notifications"
      className={`relative flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 ${className}`}
      aria-label={hasUnread ? `Notifications (${data.count} unread)` : "Notifications"}
      title="Notifications"
    >
      <Bell size={18} />
      {hasUnread && (
        <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface" />
      )}
    </Link>
  )
}
