import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ShieldCheck } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import EmptyState from "../components/ui/EmptyState"

function fmt(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })
}

function actionLabel(action) {
  return (action || "").replaceAll(".", " ").replaceAll("_", " ")
}

export default function AuditLog() {
  const [filter, setFilter] = useState("")

  const { data: entries, isLoading } = useQuery({
    queryKey: ["audit-log", filter],
    queryFn: () => api.get("/audit-log", { params: filter ? { action: filter } : {} }).then((r) => r.data),
  })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Audit Log"
        subtitle="Who changed what, and when roles, removals, org settings, leave decisions."
        actions={
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action (e.g. employee, asset, leave)…"
            className="field w-72 !rounded-full"
          />
        }
      />

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      <div className="card divide-y divide-border overflow-hidden">
        {(entries || []).map((entry) => (
          <div key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
            <Avatar name={entry.actor?.name || "System"} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-semibold text-ink">{entry.actor?.name || "System"}</span>{" "}
                <span className="text-muted">{actionLabel(entry.action)}</span>
                {entry.targetType && <span className="text-muted-2"> · {entry.targetType}</span>}
              </p>
              {entry.note && <p className="mt-0.5 truncate text-xs text-muted-2">{entry.note}</p>}
            </div>
            <p className="shrink-0 text-xs text-muted-2">{fmt(entry.createdAt)}</p>
          </div>
        ))}
        {(entries || []).length === 0 && !isLoading && (
          <div className="p-5">
            <EmptyState icon={ShieldCheck} title="No matching entries" description="Sensitive actions will start showing up here as they happen." />
          </div>
        )}
      </div>
    </div>
  )
}
