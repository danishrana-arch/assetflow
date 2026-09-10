import { useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Bell, ExternalLink, ShoppingBag, UserPlus, UserMinus, Wrench, CheckCircle2, ArrowUpCircle, ShieldAlert, Undo2, Trash2, StickyNote } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"
import EmptyState from "../components/ui/EmptyState"

const EVENT_CONFIG = {
  PURCHASED: { icon: ShoppingBag, tone: "blue", label: "Purchased" },
  ASSIGNED: { icon: UserPlus, tone: "green", label: "Assigned" },
  UNASSIGNED: { icon: UserMinus, tone: "slate", label: "Unassigned" },
  REPAIR_STARTED: { icon: Wrench, tone: "orange", label: "Repair started" },
  REPAIR_COMPLETED: { icon: CheckCircle2, tone: "green", label: "Repair completed" },
  UPGRADED: { icon: ArrowUpCircle, tone: "purple", label: "Upgraded" },
  WARRANTY_EXPIRED: { icon: ShieldAlert, tone: "pink", label: "Warranty expired" },
  RETURNED: { icon: Undo2, tone: "slate", label: "Returned" },
  DISPOSED: { icon: Trash2, tone: "pink", label: "Disposed" },
  NOTE: { icon: StickyNote, tone: "yellow", label: "Note" },
}

function timeAgo(iso) {
  if (!iso) return ""
  const then = new Date(iso).getTime()
  const s = Math.max(1, Math.round((Date.now() - then) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function Notifications() {
  const qc = useQueryClient()
  const { data: notifications = [], isLoading: notificationsLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
  })

  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications-unread-count"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    },
  })

  useEffect(() => {
    if (!notificationsLoading && notifications.some((item) => !item.readAt)) {
      markAllRead.mutate()
    }
    // This should run when the page is opened with unread notifications.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsLoading, notifications.length])

  const { data: activity, isLoading: activityLoading } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => api.get("/dashboard/activity").then((r) => r.data),
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Notifications & Activity" subtitle="Requests, updates and activity that need your attention." backTo="/" />

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-ink">Notifications</p>
            <p className="mt-0.5 text-xs text-muted">New requests and updates for your account.</p>
          </div>
          {notifications.some((item) => !item.readAt) && (
            <span className="rounded-full bg-chip-pink-bg px-2.5 py-1 text-[11px] font-semibold text-chip-pink-fg">
              New
            </span>
          )}
        </div>

        {notificationsLoading && <p className="px-5 py-6 text-sm text-muted">Loading…</p>}
        {!notificationsLoading && notifications.length === 0 && (
          <div className="px-5 py-8">
            <EmptyState title="No notifications" description="You're all caught up." />
          </div>
        )}
        {!notificationsLoading && notifications.map((notification) => (
          <div key={notification.id} className="flex items-start gap-3 border-b border-border px-5 py-4 last:border-b-0">
            <IconChip icon={Bell} tone={notification.readAt ? "slate" : "pink"} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{notification.title}</p>
              {notification.message && <p className="mt-0.5 text-xs leading-5 text-muted">{notification.message}</p>}
              <p className="mt-1 text-[11px] text-muted-2">{timeAgo(notification.createdAt)}</p>
            </div>
            {notification.link && (
              <Link to={notification.link} className="shrink-0 rounded-full p-2 text-muted hover:bg-surface-2" title="Open">
                <ExternalLink size={15} />
              </Link>
            )}
          </div>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">Activity</p>
            <p className="mt-0.5 text-xs text-muted">Recent asset and workforce activity.</p>
          </div>
        </div>

        <div className="card divide-y divide-border overflow-hidden">
          {activityLoading && <p className="px-5 py-6 text-sm text-muted">Loading…</p>}
          {(activity || []).map((event) => {
            const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.NOTE
            return (
              <div key={event.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
                <IconChip icon={cfg.icon} tone={cfg.tone} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {cfg.label}
                    {event.asset?.name && <span className="font-normal text-muted"> · {event.asset.name}</span>}
                  </p>
                  {event.note && <p className="mt-0.5 truncate text-xs text-muted">{event.note}</p>}
                  {event.actor?.name && <p className="mt-0.5 text-[11px] text-muted-2">by {event.actor.name}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-ink">{timeAgo(event.occurredAt)}</p>
                  <p className="text-[11px] text-muted-2">{new Date(event.occurredAt).toLocaleDateString()}</p>
                </div>
              </div>
            )
          })}
          {!activityLoading && (activity?.length || 0) === 0 && (
            <div className="px-5 py-8">
              <EmptyState title="No activity yet" description="Once you start managing assets, events will show up here." />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
