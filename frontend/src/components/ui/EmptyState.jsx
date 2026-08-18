import { Inbox } from "lucide-react"

export default function EmptyState({ icon: Icon = Inbox, title, description, action, className = "" }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-2xl bg-surface-2 px-6 py-10 text-center ${className}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface text-muted">
        <Icon size={22} />
      </div>
      {title && <p className="text-sm font-semibold text-ink">{title}</p>}
      {description && <p className="max-w-sm text-xs text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
