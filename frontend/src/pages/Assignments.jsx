import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Boxes, UserRound } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import IconChip from "../components/ui/IconChip"
import { SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

export default function Assignments() {
  const [assetId, setAssetId] = useState("")
  const [employeeId, setEmployeeId] = useState("")
  const queryClient = useQueryClient()

  const { data: availableAssets } = useQuery({
    queryKey: ["assets", "AVAILABLE"],
    queryFn: () => api.get("/assets", { params: { status: "AVAILABLE" } }).then((r) => r.data),
  })
  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: () => api.get("/employees").then((r) => r.data),
  })
  const { data: assignedAssets } = useQuery({
    queryKey: ["assets", "ASSIGNED"],
    queryFn: () => api.get("/assets", { params: { status: "ASSIGNED" } }).then((r) => r.data),
  })

  const assign = useMutation({
    mutationFn: () => api.post(`/assets/${assetId}/assign`, { employeeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      setAssetId(""); setEmployeeId("")
    },
  })

  return (
    <div>
      <PageHeader title="Asset Assignment" subtitle="Match available assets to your team." backTo="/" />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionHeader
            title="Assign an Asset"
            action={<IconChip icon={ClipboardCheck} tone="blue" size="sm" />}
          />
          <form
            onSubmit={(e) => { e.preventDefault(); if (assetId && employeeId) assign.mutate() }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <SelectField label="Available Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} required>
              <option value="">Select an asset…</option>
              {(availableAssets || []).map((a) => (
                <option key={a.id} value={a.id}>{a.name} — {a.serialNumber}</option>
              ))}
            </SelectField>
            <SelectField label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">Select an employee…</option>
              {(employees || []).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </SelectField>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={assign.isPending || !assetId || !employeeId}
                className="pill-accent px-5 py-2.5 text-sm disabled:opacity-50"
              >
                {assign.isPending ? "Assigning…" : "Assign"}
              </button>
            </div>
          </form>
        </div>

        <div className="card p-5">
          <SectionHeader title="Available Now" />
          <p className="mb-3 text-3xl font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
            {availableAssets?.length ?? "—"}
          </p>
          <p className="text-xs text-muted">Assets currently ready to assign.</p>
        </div>
      </div>

      <div className="mt-5 card p-5">
        <SectionHeader title="Currently Assigned" />
        <ul className="space-y-2">
          {(assignedAssets || []).map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
              <IconChip icon={Boxes} tone="blue" size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                <p className="truncate font-mono text-[11px] text-muted">{a.serialNumber}</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <UserRound size={12} />
                {a.assignedTo?.name || "—"}
              </div>
            </li>
          ))}
          {assignedAssets?.length === 0 && (
            <EmptyState icon={ClipboardCheck} title="No assignments yet" description="Assign an available asset above." />
          )}
        </ul>
      </div>
    </div>
  )
}
