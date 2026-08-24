import {
  ShoppingBag,
  UserPlus,
  UserMinus,
  Wrench,
  CheckCircle2,
  ArrowUpCircle,
  ShieldAlert,
  Undo2,
  Trash2,
  StickyNote,
} from "lucide-react"
import IconChip from "./ui/IconChip"

const EVENT_CONFIG = {
  PURCHASED: { label: "Purchased", icon: ShoppingBag, tone: "blue" },
  ASSIGNED: { label: "Assigned", icon: UserPlus, tone: "green" },
  UNASSIGNED: { label: "Unassigned", icon: UserMinus, tone: "slate" },
  REPAIR_STARTED: { label: "Repair started", icon: Wrench, tone: "orange" },
  REPAIR_COMPLETED: { label: "Repair completed", icon: CheckCircle2, tone: "green" },
  UPGRADED: { label: "Upgraded", icon: ArrowUpCircle, tone: "purple" },
  WARRANTY_EXPIRED: { label: "Warranty expired", icon: ShieldAlert, tone: "pink" },
  RETURNED: { label: "Returned", icon: Undo2, tone: "slate" },
  DISPOSED: { label: "Disposed", icon: Trash2, tone: "pink" },
  NOTE: { label: "Note", icon: StickyNote, tone: "yellow" },
}

function formatDate(iso) {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export default function LifecycleTimeline({ events = [] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No lifecycle events recorded yet.</p>
  }
  return (
    <ol className="relative space-y-4 pl-1">
      {events.map((event, i) => {
        const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.NOTE
        return (
          <li key={event.id || i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <IconChip icon={cfg.icon} tone={cfg.tone} size="sm" />
              {i < events.length - 1 && (
                <span className="mt-1 h-full w-px flex-1 bg-border" />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-semibold text-ink">{cfg.label}</p>
                <time className="text-[11px] text-muted">{formatDate(event.occurredAt)}</time>
              </div>
              {event.note && <p className="mt-0.5 text-xs text-muted">{event.note}</p>}
              {event.cost != null && (
                <p className="mt-0.5 text-xs font-semibold text-warning">Cost: PKR {Number(event.cost).toFixed(2)}</p>
              )}
              {event.actor?.name && (
                <p className="mt-0.5 text-[11px] text-muted-2">by {event.actor.name}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
