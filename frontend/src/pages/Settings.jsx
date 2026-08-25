import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import { TextField } from "../components/ui/Field"

const PRESETS = [
  { label: "Blue", value: "#3B82F6" },
  { label: "Violet", value: "#8B5CF6" },
  { label: "Cyan", value: "#06B6D4" },
  { label: "Emerald", value: "#16A34A" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Pink", value: "#EC4899" },
  { label: "Slate", value: "#0F172A" },
]

export default function Settings() {
  const { user } = useAuth()
  const isCeo = user?.role === "CEO"
  const queryClient = useQueryClient()
  const { applyAccent } = useTheme()
  const [name, setName] = useState("")
  const [primaryColor, setPrimaryColor] = useState("#3B82F6")
  const [sickLeaveAllowance, setSickLeaveAllowance] = useState(8)
  const [casualLeaveAllowance, setCasualLeaveAllowance] = useState(6)
  const [payrollBankName, setPayrollBankName] = useState("")
  const [payrollAccountNumber, setPayrollAccountNumber] = useState("")
  const [lateDeductionAmount, setLateDeductionAmount] = useState(500)
  const [workingHoursPerDay, setWorkingHoursPerDay] = useState(8)
  const [workingDaysPerWeek, setWorkingDaysPerWeek] = useState(5)

  const { data: organization } = useQuery({
    queryKey: ["organization"],
    queryFn: () => api.get("/organization").then((r) => r.data),
  })

  useEffect(() => {
    if (organization) {
      setName(organization.name || "")
      setPrimaryColor(organization.primaryColor || "#3B82F6")
      setSickLeaveAllowance(organization.sickLeaveAllowance ?? 8)
      setCasualLeaveAllowance(organization.casualLeaveAllowance ?? 6)
      setPayrollBankName(organization.payrollBankName || "")
      setPayrollAccountNumber(organization.payrollAccountNumber || "")
      setLateDeductionAmount(organization.lateDeductionAmount ?? 500)
      setWorkingHoursPerDay(organization.workingHoursPerDay ?? 8)
      setWorkingDaysPerWeek(organization.workingDaysPerWeek ?? 5)
    }
  }, [organization])

  const save = useMutation({
    mutationFn: () => api.patch("/organization", { name, primaryColor }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["organization"] })
      applyAccent(res.data.primaryColor)
    },
  })

  const savePolicy = useMutation({
    mutationFn: () => api.patch("/organization", { sickLeaveAllowance, casualLeaveAllowance }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  })

  const saveWorkSchedule = useMutation({
    mutationFn: () => api.patch("/organization", { workingHoursPerDay, workingDaysPerWeek }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  })

  const savePayrollAccount = useMutation({
    mutationFn: () => api.patch("/organization", { payrollBankName, payrollAccountNumber, lateDeductionAmount }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  })

  return (
    <div>
      <PageHeader title="Organization Settings" subtitle="Configure how your workspace looks and behaves." backTo="/" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-6">
          <SectionHeader title="Workspace" />
          <div className="space-y-4">
            <TextField label="Organization name" value={name} onChange={(e) => setName(e.target.value)} />
            {organization?.slug && (
              <p className="-mt-2 text-xs text-muted">
                New employees will be suggested emails on{" "}
                <span className="font-mono text-ink">@{organization.slug}.com</span> this updates the moment you
                save a new name. Existing employees' email addresses aren't changed automatically.
              </p>
            )}

          <div>
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
          Brand color
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => {
            const active = primaryColor.toLowerCase() === preset.value.toLowerCase()
            return (
              <button
                key={preset.value}
                type="button"
                onClick={() => setPrimaryColor(preset.value)}
                className={`h-9 w-9 rounded-full transition-transform ${active ? "scale-110 ring-2 ring-offset-2 ring-offset-surface" : ""}`}
                style={{ backgroundColor: preset.value, boxShadow: active ? `0 0 0 2px ${preset.value}` : "none" }}
                title={preset.label}
                aria-label={preset.label}
              />
            )
          })}
          <input
            type="color"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            className="h-9 w-9 cursor-pointer rounded-full border-2 border-border bg-transparent"
            aria-label="Custom color"
          />
        </div>
              <p className="mt-2 text-xs text-muted">
                Applied across buttons, charts, and highlights the moment you save.
              </p>
            </div>

            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {save.isPending ? "Saving…" : "Save changes"}
            </button>
            {save.isSuccess && !save.isPending && (
              <p className="text-xs text-chip-green-fg">Saved.</p>
            )}
          </div>
      </div>

        <div className="card p-6">
          <SectionHeader title="Leave Policy" />
          <p className="mb-4 text-xs text-muted">
            Yearly paid-leave allowance per employee. Unpaid leave has no cap but still needs approval.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Sick days / year"
              type="number"
              min={0}
              max={365}
              value={sickLeaveAllowance}
              onChange={(e) => setSickLeaveAllowance(e.target.value)}
            />
            <TextField
              label="Casual days / year"
              type="number"
              min={0}
              max={365}
              value={casualLeaveAllowance}
              onChange={(e) => setCasualLeaveAllowance(e.target.value)}
            />
          </div>
          <p className="mt-2 text-xs text-muted-2">
            Total: {Number(sickLeaveAllowance || 0) + Number(casualLeaveAllowance || 0)} paid days/year
          </p>
          <button
            onClick={() => savePolicy.mutate()}
            disabled={savePolicy.isPending}
            className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {savePolicy.isPending ? "Saving…" : "Save policy"}
          </button>
          {savePolicy.isSuccess && !savePolicy.isPending && (
            <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
          )}

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Link to="/holidays" className="pill-secondary px-4 py-2 text-xs">Manage Holidays</Link>
            <Link to="/settings/attendance-devices" className="pill-secondary px-4 py-2 text-xs">Attendance Devices</Link>
            <Link to="/audit-log" className="pill-secondary px-4 py-2 text-xs">View Audit Log</Link>
          </div>
        </div>

        {isCeo && (
          <div className="card p-6">
            <SectionHeader title="Work Schedule" />
            <p className="mb-4 text-xs text-muted">
              These values drive automatic attendance calculations. The standard 5-day week is Monday through Friday.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Working hours / day"
                type="number"
                min={1}
                max={24}
                step="0.5"
                value={workingHoursPerDay}
                onChange={(e) => setWorkingHoursPerDay(e.target.value)}
              />
              <TextField
                label="Working days / week"
                type="number"
                min={1}
                max={7}
                step="1"
                value={workingDaysPerWeek}
                onChange={(e) => setWorkingDaysPerWeek(e.target.value)}
              />
            </div>
            <p className="mt-2 text-xs text-muted-2">
              Expected weekly time: {(Number(workingHoursPerDay || 0) * Number(workingDaysPerWeek || 0)).toFixed(1)} hours.
            </p>
            <button
              onClick={() => saveWorkSchedule.mutate()}
              disabled={saveWorkSchedule.isPending}
              className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {saveWorkSchedule.isPending ? "Saving…" : "Save work schedule"}
            </button>
            {saveWorkSchedule.isSuccess && !saveWorkSchedule.isPending && (
              <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
            )}
          </div>
        )}

          <div className="card p-6">
            <SectionHeader title="Payroll Account" />
            <p className="mb-4 text-xs text-muted">
              CEO-only. Every salary is disbursed from this account no one else can see or change it.
            </p>
            <div className="space-y-4">
              <TextField
                label="Bank name"
                value={payrollBankName}
                onChange={(e) => setPayrollBankName(e.target.value)}
                placeholder="e.g. HBL, Meezan Bank"
              />
              <TextField
                label="Account number"
                value={payrollAccountNumber}
                onChange={(e) => setPayrollAccountNumber(e.target.value)}
                hint="Stored encrypted"
              />
              <TextField
                label="Late-arrival deduction (PKR / day)"
                type="number"
                min={500}
                step={100}
                value={lateDeductionAmount}
                onChange={(e) => setLateDeductionAmount(e.target.value)}
                hint="Deducted for every day an employee is marked Late"
              />
            </div>
            <button
              onClick={() => savePayrollAccount.mutate()}
              disabled={savePayrollAccount.isPending}
              className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {savePayrollAccount.isPending ? "Saving…" : "Save payroll account"}
            </button>
            {savePayrollAccount.isSuccess && !savePayrollAccount.isPending && (
              <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
            )}
          </div>

        <div className="card p-6">
          <SectionHeader title="Plan" />
          <div className="flex items-center justify-between rounded-2xl bg-surface-2 p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Current plan</p>
              <p className="mt-0.5 text-lg font-semibold text-ink">{organization?.planTier || "Free"}</p>
            </div>
            <a href="/billing" className="pill-secondary px-4 py-2 text-xs">Manage billing</a>
          </div>
          <p className="mt-4 text-xs text-muted">
            Upgrade to unlock unlimited assets, advanced reports, custom branding and more.
          </p>
        </div>
      </div>
    </div>
  )
}
