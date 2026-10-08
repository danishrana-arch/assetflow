import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import PageHeader from "../components/ui/PageHeader"
import Modal from "../components/billing/Modal"
import PlanCard from "../components/billing/PlanCard"
import PlanEditorModal from "../components/billing/PlanEditorModal"
import SaleModal from "../components/billing/SaleModal"
import ContactModal from "../components/billing/ContactModal"
import BillingHistory from "../components/billing/BillingHistory"
import InquiriesPanel from "../components/billing/InquiriesPanel"
import { CurrentSubscription, EmployeeUsage } from "../components/billing/SubscriptionSummary"
import { billingApi, errorText } from "../api/billing"
import { formatMoney, isUpgrade } from "../utils/billing"

// Billing & Subscription. Data is split the way the backend is: plans
// (pricing config), subscription + usage, invoices — and payment actions,
// which only ever return a hosted-checkout URL from the server.
export default function Billing() {
  const queryClient = useQueryClient()
  const [banner, setBanner] = useState(null) // { tone, text }
  const [confirming, setConfirming] = useState(null) // plan awaiting confirmation
  const [processingKey, setProcessingKey] = useState(null)
  const [paymentRequired, setPaymentRequired] = useState({}) // planKey → true
  const [editing, setEditing] = useState(null) // plan | "new"
  const [sale, setSale] = useState(null) // plan
  const [contacting, setContacting] = useState(false)

  const { data: plans, isLoading: plansLoading } = useQuery({ queryKey: ["billing", "plans"], queryFn: billingApi.plans })
  const { data: subscription } = useQuery({ queryKey: ["billing", "subscription"], queryFn: billingApi.subscription })
  const { data: invoices, isLoading: invoicesLoading } = useQuery({ queryKey: ["billing", "invoices"], queryFn: billingApi.invoices })

  const canManage = !!subscription?.canManagePlans
  const current = subscription?.plan || null
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["billing"] })
  const notify = (tone, text) => setBanner({ tone, text })

  const changePlan = useMutation({
    mutationFn: (plan) => billingApi.changePlan(plan.key),
    onMutate: (plan) => setProcessingKey(plan.key),
    onSuccess: (data, plan) => {
      setConfirming(null)
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl)
        return
      }
      refresh()
      notify("green", `You're now on the ${plan.name} plan.`)
    },
    onError: (err, plan) => {
      setConfirming(null)
      if (err.response?.data?.code === "PAYMENT_NOT_CONFIGURED") {
        setPaymentRequired((p) => ({ ...p, [plan.key]: true }))
      }
      notify("pink", errorText(err))
    },
    onSettled: () => setProcessingKey(null),
  })

  const portal = useMutation({
    mutationFn: billingApi.openPortal,
    onSuccess: (data) => window.location.assign(data.url),
    onError: (err) => notify("pink", errorText(err)),
  })

  const deletePlan = useMutation({
    mutationFn: (plan) => billingApi.deletePlan(plan.id),
    onSuccess: (_, plan) => { refresh(); notify("green", `Deleted the ${plan.name} plan.`) },
    onError: (err) => notify("pink", errorText(err)),
  })

  function handleSelect(plan) {
    setBanner(null)
    if (plan.isCustom) setContacting(true)
    else setConfirming(plan)
  }

  function handleDelete(plan) {
    if (window.confirm(`Delete the ${plan.name} plan? This can't be undone.`)) deletePlan.mutate(plan)
  }

  const scrollToPlans = () => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth", block: "start" })

  const confirmPrice = confirming ? formatMoney(confirming.effectivePriceCents, confirming.currency) : ""
  const confirmIsPaid = confirming && confirming.effectivePriceCents > 0
  const confirmUp = confirming && isUpgrade(current, confirming)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing & Subscription"
        subtitle="Your plan, employee usage and invoices."
        backTo="/settings"
        actions={canManage && (
          <button type="button" onClick={() => setEditing("new")} className="pill-secondary inline-flex items-center gap-2 px-5 py-2.5 text-sm">
            <Plus size={16} /> Add plan
          </button>
        )}
      />

      {banner && (
        <div
          role="status"
          className={`flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm ${banner.tone === "green" ? "bg-chip-green-bg text-chip-green-fg" : "bg-chip-pink-bg text-chip-pink-fg"}`}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="shrink-0 font-semibold underline-offset-2 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <CurrentSubscription subscription={subscription} onManageBilling={() => portal.mutate()} managing={portal.isPending} />
        <EmployeeUsage usage={subscription?.usage} onUpgrade={scrollToPlans} />
      </div>

      <section id="plans" aria-label="Choose a plan" className="scroll-mt-6">
        <h2 className="mb-4 text-base font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>Choose a Plan</h2>
        {plansLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card h-80 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid gap-4 pt-1 md:grid-cols-2 xl:grid-cols-4">
            {(plans || []).map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                current={current}
                canManage={canManage}
                processing={processingKey === plan.key}
                paymentRequired={!!paymentRequired[plan.key]}
                onSelect={handleSelect}
                onEdit={setEditing}
                onSale={setSale}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </section>

      <BillingHistory invoices={invoices} loading={invoicesLoading} />

      <InquiriesPanel canManage={canManage} />

      <section className="card flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center sm:p-6" aria-label="Help">
        <div>
          <h2 className="text-base font-semibold text-ink">Need help?</h2>
          <p className="mt-1 text-sm text-muted">Questions about plans, billing or a custom setup? Our team is happy to help.</p>
        </div>
        <button type="button" onClick={() => setContacting(true)} className="pill-secondary w-full shrink-0 px-5 py-2.5 text-sm sm:w-auto">Contact ManagementDock Team</button>
      </section>

      {confirming && (
        <Modal
          title={confirmIsPaid ? `${confirmUp ? "Upgrade" : "Switch"} to ${confirming.name}?` : `Switch to ${confirming.name}?`}
          subtitle={
            confirmIsPaid
              ? `You will be subscribed to the ${confirming.name} plan for ${confirmPrice}/month.`
              : `Your plan changes immediately and your employee limit becomes ${confirming.employeeLimit ?? "unlimited"}.`
          }
          onClose={() => setConfirming(null)}
          busy={changePlan.isPending}
          footer={
            <>
              <button type="button" onClick={() => setConfirming(null)} disabled={changePlan.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
              <button type="button" onClick={() => changePlan.mutate(confirming)} disabled={changePlan.isPending} className="pill-accent px-5 py-2.5 text-sm">
                {changePlan.isPending ? "Processing…" : confirmIsPaid ? "Continue to Checkout" : `Switch to ${confirming.name}`}
              </button>
            </>
          }
        >
          {confirming.sale?.active && (
            <p className="pb-2 text-sm text-muted">Includes {confirming.sale.percent}% off — regularly {formatMoney(confirming.priceCents, confirming.currency)}/month.</p>
          )}
        </Modal>
      )}

      {editing && (
        <PlanEditorModal
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved, wasEdit) => {
            setEditing(null)
            refresh()
            notify("green", wasEdit ? `Saved the ${saved.name} plan.` : `Created the ${saved.name} plan.`)
          }}
        />
      )}

      {sale && (
        <SaleModal
          plan={sale}
          onClose={() => setSale(null)}
          onSaved={(saved) => {
            setSale(null)
            refresh()
            notify("green", saved.sale ? `${saved.name} is on sale — ${saved.sale.percent}% off.` : `The ${saved.name} sale has ended.`)
          }}
        />
      )}

      {contacting && (
        <ContactModal
          defaultEmployees={subscription?.usage ? subscription.usage.used : undefined}
          onClose={() => setContacting(false)}
          onSent={() => queryClient.invalidateQueries({ queryKey: ["billing", "inquiries"] })}
        />
      )}
    </div>
  )
}
