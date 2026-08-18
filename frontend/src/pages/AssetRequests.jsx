import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, X, PackageCheck } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import StatusPill from "../components/ui/StatusPill"
import { SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const STATUS_TONE = { PENDING: "yellow", APPROVED: "blue", REJECTED: "pink", FULFILLED: "green" }

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export default function AssetRequests() {
  const [statusFilter, setStatusFilter] = useState("PENDING")
  const [fulfillingId, setFulfillingId] = useState(null)
  const [selectedAssetId, setSelectedAssetId] = useState("")
  const queryClient = useQueryClient()

  const { data: requests, isLoading } = useQuery({
    queryKey: ["asset-requests", statusFilter],
    queryFn: () => api.get("/asset-requests", { params: statusFilter ? { status: statusFilter } : {} }).then((r) => r.data),
  })

  const fulfillingRequest = requests?.find((r) => r.id === fulfillingId)

  const { data: availableAssets } = useQuery({
    queryKey: ["assets", "AVAILABLE", fulfillingRequest?.category],
    queryFn: () => api.get("/assets", { params: { status: "AVAILABLE", category: fulfillingRequest.category } }).then((r) => r.data),
    enabled: !!fulfillingRequest,
  })

  const review = useMutation({
    mutationFn: ({ id, decision }) => api.patch(`/asset-requests/${id}/review`, { decision }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-requests"] }),
  })

  const fulfill = useMutation({
    mutationFn: ({ id, assetId }) => api.post(`/asset-requests/${id}/fulfill`, { assetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-requests"] })
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      setFulfillingId(null)
      setSelectedAssetId("")
    },
  })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Asset Requests"
        subtitle="Employee equipment requests approve, then hand over a specific asset."
        actions={
          <SelectField value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-44">
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved — awaiting fulfillment</option>
            <option value="FULFILLED">Fulfilled</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All</option>
          </SelectField>
        }
      />

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      <div className="space-y-3">
        {(requests || []).map((r) => (
          <div key={r.id} className="card p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Avatar name={r.employee?.name || "?"} size="md" />
                <div>
                  <p className="text-sm font-semibold text-ink">{r.employee?.name}</p>
                  <p className="text-xs text-muted">
                    Wants: <span className="font-medium text-ink">{r.category}</span>
                    {r.employee?.department?.name ? ` · ${r.employee.department.name}` : ""} · {fmt(r.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-2">{r.reason}</p>
                  {r.fulfilledAsset && (
                    <p className="mt-1 text-xs font-medium text-chip-green-fg">
                      Fulfilled with {r.fulfilledAsset.name} ({r.fulfilledAsset.serialNumber})
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatusPill tone={STATUS_TONE[r.status]}>{r.status}</StatusPill>
                {r.status === "PENDING" && (
                  <>
                    <button
                      onClick={() => review.mutate({ id: r.id, decision: "APPROVED" })}
                      disabled={review.isPending}
                      className="pill-accent flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      <Check size={13} /> Approve
                    </button>
                    <button
                      onClick={() => review.mutate({ id: r.id, decision: "REJECTED" })}
                      disabled={review.isPending}
                      className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-xs text-danger disabled:opacity-60"
                    >
                      <X size={13} /> Reject
                    </button>
                  </>
                )}
                {r.status === "APPROVED" && (
                  <button
                    onClick={() => { setFulfillingId(r.id); setSelectedAssetId("") }}
                    className="pill-accent flex items-center gap-1.5 px-3.5 py-2 text-xs"
                  >
                    <PackageCheck size={13} /> Fulfill
                  </button>
                )}
              </div>
            </div>

            {fulfillingId === r.id && (
              <form
                onSubmit={(e) => { e.preventDefault(); if (selectedAssetId) fulfill.mutate({ id: r.id, assetId: selectedAssetId }) }}
                className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end"
              >
                <SelectField label={`Available ${r.category}`} value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} className="flex-1">
                  <option value="">Select an asset…</option>
                  {(availableAssets || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} — {a.serialNumber}</option>
                  ))}
                </SelectField>
                <div className="flex gap-2">
                  <button type="submit" disabled={!selectedAssetId || fulfill.isPending} className="pill-accent px-4 py-2.5 text-sm disabled:opacity-60">
                    {fulfill.isPending ? "Assigning…" : "Confirm"}
                  </button>
                  <button type="button" onClick={() => setFulfillingId(null)} className="pill-secondary px-4 py-2.5 text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}

        {(requests || []).length === 0 && !isLoading && (
          <EmptyState title="No asset requests" description="Nothing matches this filter right now." />
        )}
      </div>
    </div>
  )
}
