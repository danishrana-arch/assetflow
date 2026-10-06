import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CalendarDays, Plus, Trash2 } from "lucide-react"
import api from "../api/client"
import { TextField } from "./ui/Field"
import SectionHeader from "./ui/SectionHeader"
import EmptyState from "./ui/EmptyState"

function fmt(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Public holidays (Announcements page → Holidays tab). Everyone sees the
// list; `canManage` (the "leave" module: ADMIN/CEO/HR/DEPARTMENT_HEAD, same
// as POST/DELETE /holidays) adds and removes them, and can announce a new
// holiday to everyone in the same step.
export default function HolidaysPanel({ canManage, canAnnounce }) {
  const queryClient = useQueryClient()
  const [year, setYear] = useState(new Date().getFullYear())
  const [form, setForm] = useState({ date: "", name: "" })
  const [announce, setAnnounce] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays", year],
    queryFn: () => api.get("/holidays", { params: { year } }).then((r) => r.data),
  })

  const addHoliday = useMutation({
    mutationFn: async () => {
      const { data: holiday } = await api.post("/holidays", { date: form.date, name: form.name.trim() })
      let announced = false
      if (canAnnounce && announce) {
        try {
          await api.post("/dashboard/announcements", {
            title: `Holiday: ${holiday.name}`,
            body: `${holiday.name} on ${fmt(holiday.date)} is a public holiday. The office is closed and it does not count against anyone's leave balance.`,
            audienceType: "ALL",
            audienceId: null,
          })
          announced = true
        } catch {
          // The holiday itself is saved; only the announcement failed.
        }
      }
      return { holiday, announced }
    },
    onSuccess: ({ holiday, announced }) => {
      queryClient.invalidateQueries({ queryKey: ["holidays"] })
      if (announced) queryClient.invalidateQueries({ queryKey: ["announcements"] })
      setForm({ date: "", name: "" })
      setError("")
      setNotice(`${holiday.name} added${announced ? " and announced to everyone" : ""}.${canAnnounce && announce && !announced ? " The announcement couldn't be posted — publish it from the Announcements tab." : ""}`)
      const y = new Date(holiday.date).getUTCFullYear()
      if (y !== year) setYear(y)
    },
    onError: (err) => { setNotice(""); setError(err.response?.data?.error || "Could not add holiday") },
  })

  const removeHoliday = useMutation({
    mutationFn: (id) => api.delete(`/holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["holidays"] }),
    onError: (err) => setError(err.response?.data?.error || "Could not remove holiday"),
  })

  const today = todayKey()
  const years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1]

  return (
    <div className="space-y-5">
      {canManage && (
        <div className="card p-5">
          <SectionHeader title="Add holiday" />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setNotice("")
              if (form.date && form.name.trim()) addHoliday.mutate()
            }}
            className="space-y-4"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                maxLength={120}
                required
              />
              <button type="submit" disabled={addHoliday.isPending} className="pill-accent flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm disabled:opacity-60">
                <Plus size={14} /> {addHoliday.isPending ? "Adding…" : "Add holiday"}
              </button>
            </div>
            {canAnnounce && (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                Also announce it to everyone
              </label>
            )}
            <p className="text-xs text-muted">Holidays don't count against leave balances and aren't marked absent.</p>
          </form>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          {notice && <p className="mt-3 text-sm text-success">{notice}</p>}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <h3 className="section-title">Public holidays</h3>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="field w-28 !py-2" aria-label="Year">
            {(years.includes(year) ? years : [...years, year].sort()).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {isLoading && <p className="px-5 py-4 text-sm text-muted">Loading…</p>}
        <div className="divide-y divide-border">
          {holidays.map((h) => {
            const key = String(h.date).slice(0, 10)
            const upcoming = key >= today
            return (
              <div key={h.id} className={`flex items-center justify-between gap-3 px-5 py-3.5 ${upcoming ? "" : "opacity-60"}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CalendarDays size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{h.name}</p>
                    <p className="text-xs text-muted">{fmt(h.date)}{key === today ? " · Today" : ""}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {upcoming && <span className="rounded-full bg-chip-green-bg px-2.5 py-1 text-[10px] font-semibold text-chip-green-fg">Upcoming</span>}
                  {canManage && (
                    <button
                      onClick={() => { if (window.confirm(`Remove ${h.name} (${fmt(h.date)})?`)) removeHoliday.mutate(h.id) }}
                      disabled={removeHoliday.isPending}
                      className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                      aria-label={`Remove ${h.name}`}
                      title="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {holidays.length === 0 && !isLoading && (
          <div className="p-5">
            <EmptyState
              title={`No holidays for ${year}`}
              description={canManage ? `Add ${year}'s public holidays so they're excluded from leave balances.` : "Public holidays your company adds will show here."}
            />
          </div>
        )}
      </div>
    </div>
  )
}
