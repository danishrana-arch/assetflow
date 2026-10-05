import { useState } from "react"
import { Building2, ChevronDown, Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "../context/AuthContext"

// Tree-style option labels for a native <select> (leading spaces must be
// non-breaking or the browser strips them). The API returns the list in
// tree order with a `depth` per row (backend utils/organization.js):
//   Grand Parent A
//    └─ Parent
//        └─ Child 1
//   Grand Parent B
//    └─ Child 2
const NBSP = " "
export function treeLabels(organizations) {
  const labels = {}
  for (const org of organizations) {
    const depth = org.depth || 0
    const suffix = `${org.isGrandParent ? " — Grand Parent" : org.isParent ? " — Parent" : ""}${org.isCallCenter ? " · Call center" : ""}`
    labels[org.id] = `${depth ? `${NBSP.repeat(depth * 4 - 3)}└─ ` : ""}${org.name}${suffix}`
  }
  return labels
}

export default function OrganizationSwitcher({ compact = false }) {
  const { user, organization, organizations, switchOrganization } = useAuth()
  const queryClient = useQueryClient()
  const [switching, setSwitching] = useState(false)

  if (!user) return null

  // The API only returns organizations this user may access, already in
  // tree order (backend utils/organization.js).
  const canSwitch = ["ADMIN", "CEO", "IT_MANAGER"].includes(user.role) && organizations.length > 1
  const home = organizations.find((o) => o.id === user.homeOrganizationId)
  const main = home || organizations[0] || organization
  const labels = treeLabels(organizations)

  async function handleChange(event) {
    const id = event.target.value
    if (!id || id === organization?.id || switching) return

    setSwitching(true)
    try {
      // Prevent another organization's cached tables/cards from flashing while
      // the selected organization is being loaded.
      queryClient.clear()
      await switchOrganization(id)
    } finally {
      setSwitching(false)
    }
  }

  if (!canSwitch) {
    return (
      <div className={`flex min-w-0 items-center gap-2 ${compact ? "max-w-[180px]" : "max-w-[300px]"}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <Building2 size={15} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-2">Organization</p>
          <p className="truncate text-sm font-semibold text-ink">{organization?.name || "ManagementDock"}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 items-center gap-2 ${compact ? "max-w-[240px]" : "max-w-[380px]"}`}>
      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-2">
          {main?.isGrandParent ? "Grand parent" : main?.isParent ? "Parent company" : "Company"}
        </p>
        <p className="max-w-[140px] truncate text-xs font-semibold text-ink">{main?.name || "Company"}</p>
      </div>
      <div className="relative min-w-0 flex-1">
        <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <select
          value={organization?.id || ""}
          onChange={handleChange}
          disabled={switching}
          aria-label="Select organization"
          className="field w-full appearance-none pl-9 pr-9 text-xs font-semibold disabled:opacity-60"
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {labels[org.id]}
            </option>
          ))}
        </select>
        {switching ? (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted" />
        ) : (
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
        )}
      </div>
    </div>
  )
}
