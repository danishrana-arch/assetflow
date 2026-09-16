import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Building2, Users, Boxes, FolderKanban, Activity } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import { useAuth } from "../context/AuthContext"

export default function OrganizationComparison() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [confirmId, setConfirmId] = useState(null)
  const [error, setError] = useState("")

  const q = useQuery({
    queryKey: ["organization-comparison"],
    queryFn: () => api.get("/organization/comparison").then((r) => r.data),
  })

  const setMain = useMutation({
    mutationFn: (targetOrganizationId) =>
      api.patch("/organization/company/set-main", { targetOrganizationId }).then((r) => r.data),
    onSuccess: () => {
      setConfirmId(null)
      setError("")
      queryClient.invalidateQueries({ queryKey: ["organization-comparison"] })
      queryClient.invalidateQueries({ queryKey: ["organization"] })
    },
    onError: (err) => setError(err?.response?.data?.error || "Could not change the main company"),
  })

  const canChangeMain = user?.role === "CEO"

  return (
    <div>
      <PageHeader
        title="Organization Comparison"
        subtitle="Compare every active organization under the company from one view."
        backTo="/"
      />
      {error && <p className="mb-4 text-xs font-medium text-red-500">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(q.data || []).map((o) => (
          <div key={o.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                <Building2 size={19} />
              </div>
              {o.isMain && (
                <span className="rounded-full bg-accent/10 px-2 py-1 text-[9px] font-semibold text-accent">
                  Main company
                </span>
              )}
            </div>
            <p className="mt-4 text-base font-semibold text-ink">{o.name}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                [Users, "Employees", o.employees],
                [Activity, "Present today", o.presentToday],
                [Boxes, "Assets", o.assets],
                [Boxes, "Utilization", `${o.utilizationRate}%`],
                [FolderKanban, "Active projects", o.activeProjects],
                [FolderKanban, "Completed", o.completedProjects],
              ].map(([Icon, label, value]) => (
                <div key={label} className="rounded-2xl bg-surface-2 p-3">
                  <Icon size={14} className="text-muted" />
                  <p className="mt-2 text-lg font-semibold text-ink">{value}</p>
                  <p className="text-[10px] text-muted">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between text-xs text-muted">
              <span>
                Attendance: <b className="text-ink">{o.attendanceRate}%</b>
              </span>
              <span>{o.departments} departments</span>
            </div>

            {canChangeMain && !o.isMain && (
              <div className="mt-4 border-t border-border pt-3">
                {confirmId === o.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setMain.mutate(o.id)}
                      disabled={setMain.isPending}
                      className="pill-accent px-3 py-1.5 text-xs disabled:opacity-60"
                    >
                      {setMain.isPending ? "Applying…" : "Confirm — make main"}
                    </button>
                    <button onClick={() => setConfirmId(null)} className="px-3 py-1.5 text-xs text-muted">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmId(o.id)} className="text-xs font-semibold text-accent">
                    Make this the main company
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!q.data?.length && !q.isLoading && (
          <div className="card p-10 text-sm text-muted">No organizations available.</div>
        )}
      </div>
    </div>
  )
}
