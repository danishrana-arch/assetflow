import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X, Building2, Users, Boxes } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import IconChip from "../components/ui/IconChip"
import { TextField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const TONES = ["blue", "purple", "cyan", "orange", "green", "pink", "yellow"]

export default function Departments() {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const queryClient = useQueryClient()

  const { data: departments, isLoading } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
  })

  const createDepartment = useMutation({
    mutationFn: () => api.post("/departments", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments"] })
      setShowForm(false); setName(""); setError("")
    },
    onError: (err) => setError(err.response?.data?.error || "Could not create department"),
  })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Departments"
        subtitle="Group people and assets by team."
        actions={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? "Cancel" : "Add Department"}
          </button>
        }
      />

      {showForm && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) createDepartment.mutate() }}
          className="card mb-5 flex flex-wrap items-end gap-3 p-5"
        >
          <TextField
            label="Department name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Marketing"
            required
            className="min-w-[240px] flex-1"
          />
          <button type="submit" disabled={createDepartment.isPending} className="pill-accent px-5 py-2.5 text-sm">
            Create
          </button>
          {error && <p className="w-full text-sm text-danger">{error}</p>}
        </form>
      )}

      {isLoading && <p className="text-sm text-muted">Loading...</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(departments || []).map((dept, i) => {
          const tone = TONES[i % TONES.length]
          return (
            <div key={dept.id} className="card p-5">
              <div className="flex items-start justify-between">
                <IconChip icon={Building2} tone={tone} size="md" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                  Team
                </span>
              </div>
              <p className="mt-4 text-lg font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
                {dept.name}
              </p>
              <div className="mt-4 flex items-center gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Users size={12} /> {dept._count?.employees || 0} employees
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Boxes size={12} /> {dept._count?.assets || 0} assets
                </span>
              </div>
            </div>
          )
        })}
        {departments?.length === 0 && !isLoading && (
          <div className="sm:col-span-2 lg:col-span-3">
            <EmptyState icon={Building2} title="No departments yet" description="Create departments to organize employees and assets." />
          </div>
        )}
      </div>
    </div>
  )
}
