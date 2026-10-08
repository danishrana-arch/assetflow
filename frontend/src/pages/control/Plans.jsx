import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import PlanCard from "../../components/billing/PlanCard"
import PlanEditorModal from "../../components/billing/PlanEditorModal"
import SaleModal from "../../components/billing/SaleModal"
import ConfirmDialog from "../../components/control/ConfirmDialog"
import { platformApi } from "../../api/platform"
import { errorMessage } from "../../components/control/shared"
import { SectionTitle } from "./ControlCenterLayout"

// Plan management. Reuses the company Billing page's plan card, editor and
// sale dialog — pointed at the platform API — so there is one plan UI.
export default function Plans() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(null) // plan | "new"
  const [sale, setSale] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState("")
  const { data: plans, isLoading, error: loadError } = useQuery({ queryKey: ["platform", "plans"], queryFn: platformApi.plans })
  const { data: featureData } = useQuery({ queryKey: ["platform", "features"], queryFn: platformApi.features })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform"] })

  const remove = useMutation({
    mutationFn: (plan) => platformApi.deletePlan(plan.id),
    onSuccess: () => { setDeleting(null); setError(""); refresh() },
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <>
      <SectionTitle
        title="Plans"
        subtitle="Price, limits and the features each plan includes. A price change applies to new subscriptions; limits and features apply to everyone on the plan."
        actions={<button type="button" onClick={() => setEditing("new")} className="pill-secondary inline-flex items-center gap-2 px-4 py-2 text-sm"><Plus size={15} /> Add plan</button>}
      />
      {loadError && <p role="alert" className="mb-2 text-sm text-danger">{errorMessage(loadError)}</p>}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-80 animate-pulse rounded-2xl bg-surface-2" />)}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => (
            <div key={plan.id} className="flex flex-col">
              <PlanCard plan={plan} current={null} canManage onSelect={() => setEditing(plan)} onEdit={setEditing} onSale={setSale} onDelete={(p) => { setError(""); setDeleting(p) }} />
              <div className="mt-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted">
                <p><span className="font-semibold text-ink">Includes:</span> {plan.featureKeys.length ? featureData ? featureData.features.filter((f) => plan.featureKeys.includes(f.key)).map((f) => f.label).join(", ") : `${plan.featureKeys.length} features` : "No features"}</p>
                <p className="mt-1">Limits — sites {plan.siteLimit ?? "no cap"}, projects {plan.projectLimit ?? "no cap"}, organizations {plan.organizationLimit ?? "no cap"}, storage {plan.storageLimitMb != null ? `${plan.storageLimitMb} MB` : "no cap"}</p>
                <p className="mt-1">Billed {plan.billingInterval === "MONTH" ? "monthly" : plan.billingInterval.toLowerCase()}{plan.stripePriceId ? ` · provider price ${plan.stripePriceId}` : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <PlanEditorModal
          plan={editing === "new" ? undefined : editing}
          api={platformApi}
          features={featureData?.features || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
        />
      )}
      {sale && <SaleModal plan={sale} api={platformApi} onClose={() => setSale(null)} onSaved={() => { setSale(null); refresh() }} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete the ${deleting.name} plan?`}
          message="This can't be undone. A plan that organizations are on can't be deleted — deactivate it instead."
          confirmLabel="Delete plan"
          danger
          busy={remove.isPending}
          error={error}
          onClose={() => setDeleting(null)}
          onConfirm={() => remove.mutate(deleting)}
        />
      )}
    </>
  )
}
