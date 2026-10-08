import { useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "../context/AuthContext"

export default function OrganizationSwitcher({ compact = false, glass = false }) {
  const { user, organization, organizations, switchOrganization } = useAuth()
  const queryClient = useQueryClient()
  const [switching, setSwitching] = useState(false)

  if (!user) return null

  // The API only returns organizations this user may access, own first
  // (backend utils/organization.js).
  const canSwitch = ["ADMIN", "CEO", "IT_MANAGER"].includes(user.role) && organizations.length > 1

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
      <div className={`flex min-w-0 items-center gap-2 ${glass ? "glass-chip h-11 rounded-full py-1 pl-4 pr-4" : ""} ${compact ? "max-w-[180px]" : "max-w-[300px]"}`}>
        <div className="min-w-0">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-2">Organization</p>
          <p className="truncate text-sm font-semibold text-ink">{organization?.name || "ManagementDock"}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 items-center gap-2 ${compact ? "max-w-[200px]" : "max-w-[260px]"}`}>
      <div className="relative min-w-0 flex-1">
        <select
          value={organization?.id || ""}
          onChange={handleChange}
          disabled={switching}
          aria-label="Select organization"
          className={glass
            ? "glass-chip h-11 w-full cursor-pointer appearance-none rounded-full pl-5 pr-10 text-xs font-semibold text-ink disabled:opacity-60"
            : "field w-full appearance-none pl-3 pr-9 text-xs font-semibold disabled:opacity-60"}
        >
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {switching ? (
          <span className="pointer-events-none absolute right-4 top-1/2 z-10 -translate-y-1/2 text-muted">
            <Loader2 size={14} className="animate-spin" />
          </span>
        ) : (
          <ChevronDown size={14} className="pointer-events-none absolute right-4 top-1/2 z-10 -translate-y-1/2 text-muted" />
        )}
      </div>
    </div>
  )
}
