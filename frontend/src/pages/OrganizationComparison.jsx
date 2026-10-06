import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { Building2, Users, Boxes, FolderKanban, Activity } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"

// Only the companies the viewer may access are returned (CEO: all; Admin:
// own + the ones a CEO gave them). Access is managed in Settings.

export default function OrganizationComparison() {
  const q = useQuery({
    queryKey: ["organization-comparison"],
    queryFn: () => api.get("/organization/comparison").then((r) => r.data),
  })

  return (
    <div>
      <PageHeader
        title="Organization Comparison"
        subtitle="Compare every company you can access from one view."
        backTo="/"
        actions={
          <Link to="/settings" className="pill-secondary px-4 py-2.5 text-sm">
            Company access
          </Link>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(q.data || []).map((o) => (
          <div key={o.id} className="card p-5">
            <div className="flex items-start justify-between">
              <div className="flex h-10 w-10 items-center justify-center text-ink">
                <Building2 size={19} />
              </div>
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
          </div>
        ))}
        {!q.data?.length && !q.isLoading && (
          <div className="card p-10 text-sm text-muted">No organizations available.</div>
        )}
      </div>
    </div>
  )
}
