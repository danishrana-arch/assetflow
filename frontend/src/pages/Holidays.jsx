import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import { TextField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

export default function Holidays() {
  const queryClient = useQueryClient()
  const [year, setYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({ date: "", name: "" })
  const [error, setError] = useState("")

  const { data: holidays, isLoading } = useQuery({
    queryKey: ["holidays", year],
    queryFn: () => api.get("/holidays", { params: { year } }).then((r) => r.data),
  })

  const addHoliday = useMutation({
    mutationFn: () => api.post("/holidays", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] })
      setForm({ date: "", name: "" })
      setError("")
    },
    onError: (err) => setError(err.response?.data?.error || "Could not add holiday"),
  })

  const removeHoliday = useMutation({
    mutationFn: (id) => api.delete(`/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
  })

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Public Holidays"
        subtitle="Days that don't count against anyone's leave balance."
        actions={
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="field w-28 !py-2"
          >
            {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        }
      />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (form.date && form.name.trim()) addHoliday.mutate()
        }}
        className="card mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-end"
      >
        <TextField
          label="Date"
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className="sm:w-48"
          required
        />
        <TextField
          label="Holiday name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Independence Day"
          className="flex-1"
          required
        />
        <button type="submit" disabled={addHoliday.isPending} className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60">
          <Plus size={14} /> Add
        </button>
      </form>
      {error && <p className="-mt-3 mb-4 text-sm text-danger">{error}</p>}

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      <div className="card divide-y divide-border overflow-hidden">
        {(holidays || []).map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
            <div>
              <p className="text-sm font-semibold text-ink">{h.name}</p>
              <p className="text-xs text-muted">{fmt(h.date)}</p>
            </div>
            <button
              onClick={() => removeHoliday.mutate(h.id)}
              disabled={removeHoliday.isPending}
              className="text-muted hover:text-danger"
              aria-label={`Remove ${h.name}`}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        {(holidays || []).length === 0 && !isLoading && (
          <div className="p-5">
            <EmptyState title="No holidays set" description={`Add ${year}'s public holidays so they're excluded from leave balances.`} />
          </div>
        )}
      </div>
    </div>
  )
}
