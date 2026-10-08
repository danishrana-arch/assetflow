import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2 } from "lucide-react"
import { billingApi, errorText } from "../../api/billing"
import { formatDate } from "../../utils/billing"

const STATUSES = [
  { key: "NEW", label: "New" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "CLOSED", label: "Closed" },
]

// "Contact Our Team" requests. Plan managers see every company's and can
// update the status or delete; everyone else sees their own company's.
export default function InquiriesPanel({ canManage }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState("")
  const { data: inquiries, isLoading } = useQuery({ queryKey: ["billing", "inquiries"], queryFn: billingApi.inquiries })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["billing", "inquiries"] })

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => billingApi.setInquiryStatus(id, status),
    onSuccess: refresh,
    onError: (err) => setError(errorText(err)),
  })
  const remove = useMutation({
    mutationFn: (id) => billingApi.deleteInquiry(id),
    onSuccess: refresh,
    onError: (err) => setError(errorText(err)),
  })

  if (isLoading || !inquiries?.length) return null

  return (
    <section className="card p-5 sm:p-6" aria-label="Sales inquiries">
      <h2 className="text-base font-semibold text-ink" style={{ letterSpacing: "-0.01em" }}>{canManage ? "Sales inquiries" : "Your inquiries"}</h2>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ul className="mt-4 space-y-3">
        {inquiries.map((q) => (
          <li key={q.id} className="rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{q.name} <span className="font-normal text-muted">· {q.email}</span></p>
                <p className="mt-0.5 text-xs text-muted">
                  {canManage && q.organization?.name ? `${q.organization.name} · ` : ""}
                  {q.company ? `${q.company} · ` : ""}
                  {q.employeeCount ? `${q.employeeCount} employees · ` : ""}
                  {formatDate(q.createdAt)}
                </p>
              </div>
              {canManage ? (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Inquiry status"
                    value={q.status}
                    disabled={setStatus.isPending}
                    onChange={(e) => setStatus.mutate({ id: q.id, status: e.target.value })}
                    className="field w-auto py-1.5 text-xs"
                  >
                    {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  <button
                    type="button"
                    aria-label="Delete inquiry"
                    disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Delete the inquiry from ${q.name}?`)) remove.mutate(q.id) }}
                    className="rounded-full p-2 text-danger transition-colors hover:bg-surface"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : (
                <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-muted">{STATUSES.find((s) => s.key === q.status)?.label}</span>
              )}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-ink">{q.message}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
