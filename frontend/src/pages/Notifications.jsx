import { useQuery } from "@tanstack/react-query"
import {
  ShoppingBag, UserPlus, UserMinus, Wrench, CheckCircle2,
  ArrowUpCircle, ShieldAlert, Undo2, Trash2, StickyNote,
} from "lucide-react"
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
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export default function Notifications() {
  const { data: activity, isLoading } = useQuery({
    queryKey: ["dashboard-activity"],
    queryFn: () => api.get("/dashboard/activity").then((r) => r.data),
  })

  return (
    <div>
      <PageHeader title="Activity" subtitle="Everything happening across your assets and people." backTo="/" />

      <div className="card divide-y divide-border overflow-hidden">
        {isLoading && <p className="px-5 py-6 text-sm text-muted">Loading…</p>}
        {(activity || []).map((event) => {
          const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.NOTE
          return (
            <div key={event.id} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2">
              <IconChip icon={cfg.icon} tone={cfg.tone} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {cfg.label}
                  {event.asset?.name && <span className="text-muted font-normal"> · {event.asset.name}</span>}
                </p>
                {event.note && <p className="mt-0.5 truncate text-xs text-muted">{event.note}</p>}
                {event.actor?.name && (
                  <p className="mt-0.5 text-[11px] text-muted-2">by {event.actor.name}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-ink">{timeAgo(event.occurredAt)}</p>
                <p className="text-[11px] text-muted-2">{new Date(event.occurredAt).toLocaleDateString()}</p>
              </div>
            </div>
          )
        })}
        {!isLoading && (activity?.length || 0) === 0 && (
          <div className="px-5 py-8">
            <EmptyState title="No activity yet" description="Once you start managing assets, events will show up here." />
          </div>
        )}
      </div>
    </div>
  )
}
