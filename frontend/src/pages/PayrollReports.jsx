import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { Wallet, TrendingUp, TrendingDown, FileClock } from "lucide-react"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import IconChip from "../components/ui/IconChip"
import EmptyState from "../components/ui/EmptyState"
import { SelectField } from "../components/ui/Field"

const STATUS_META = {
  DRAFT: { label: "Draft", color: "#707978" },
  PENDING_APPROVAL: { label: "Pending approval", color: "#E08800" },
  PAID: { label: "Paid", color: "#16A34A" },
}

function money(value) {
  return `PKR ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PayrollReports() {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(String(currentYear))
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => String(currentYear - i)), [currentYear])

  const { data: summary, isLoading } = useQuery({
    queryKey: ["payroll-summary", year],
    queryFn: () => api.get("/payroll/summary", { params: { year } }).then((r) => r.data),
  })

  const chartData = useMemo(() => {
    if (!summary) return []
    return summary.byMonth.map((m) => ({
      name: new Date(Date.UTC(2000, m.month - 1, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }),
      netPay: m.netPay,
      count: m.count,
    }))
  }, [summary])

  const hasAnyRecords = summary?.byMonth?.some((m) => m.count > 0)
  const statusTotal = summary ? (summary.byStatus.DRAFT || 0) + (summary.byStatus.PENDING_APPROVAL || 0) + (summary.byStatus.PAID || 0) : 0

  return (
    <div>
      <PageHeader
        backTo="/"
        title="Payroll Reports"
        subtitle="Monthly payout breakdowns by department and status."
        actions={(
          <SelectField value={year} onChange={(e) => setYear(e.target.value)} className="w-32">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </SelectField>
        )}
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard icon={Wallet} tone="blue" label={`Total net pay in ${year}`} value={summary ? money(summary.totalNetPay) : "—"} />
        <MetricCard icon={TrendingUp} tone="green" label="Paid payslips" value={summary?.byStatus?.PAID ?? "—"} />
        <MetricCard icon={FileClock} tone="orange" label="Draft + pending" value={summary ? (summary.byStatus.DRAFT || 0) + (summary.byStatus.PENDING_APPROVAL || 0) : "—"} />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <SectionHeader title="Net Pay by Month" showMenu />
          {hasAnyRecords ? (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={50} />
                  <Tooltip
                    cursor={{ fill: "var(--surface-2)" }}
                    formatter={(value) => money(value)}
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: 12,
                      boxShadow: "var(--shadow-card)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="netPay" fill="#0058BE" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Wallet} title="No payroll records yet" description={`No payslips were generated for ${year}.`} />
          )}
        </div>

        <div className="card p-5">
          <SectionHeader title="Status Breakdown" />
          {statusTotal > 0 ? (
            <ul className="space-y-2">
              {Object.entries(STATUS_META).map(([key, meta]) => {
                const value = summary?.byStatus?.[key] || 0
                const pct = statusTotal ? Math.round((value / statusTotal) * 100) : 0
                return (
                  <li key={key} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} />
                    <span className="flex-1 text-sm text-ink">{meta.label}</span>
                    <span className="text-xs text-muted">{value}</span>
                    <span className="w-10 text-right text-xs font-semibold text-ink">{pct}%</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState icon={TrendingDown} title="No payslips yet" description="Status breakdown will appear once payroll is generated." />
          )}
        </div>
      </section>

      <section className="mt-5">
        <div className="card p-5">
          <SectionHeader title="By Department" showMenu />
          {summary?.byDepartment?.length > 0 ? (
            <ul className="space-y-2">
              {summary.byDepartment.map((d) => (
                <li key={d.department} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-ink">{d.department}</span>
                  <span className="text-xs text-muted">{d.count} payslip{d.count === 1 ? "" : "s"}</span>
                  <span className="w-28 text-right text-sm font-semibold text-ink">{money(d.netPay)}</span>
                </li>
              ))}
            </ul>
          ) : !isLoading && (
            <EmptyState icon={Wallet} title="No department data yet" description="Department totals will appear once payroll is generated." />
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ icon, tone, label, value }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <IconChip icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="truncate text-lg font-bold text-ink">{value}</p>
        <p className="truncate text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}
