import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { MapPin } from "lucide-react"
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
  const { user, organizations, refreshUser, switchOrganization } = useAuth()
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
  const [subOrganizationName, setSubOrganizationName] = useState("")
  const [organizationError, setOrganizationError] = useState("")
  const [geofenceEnabled, setGeofenceEnabled] = useState(false)
  const [officeLatitude, setOfficeLatitude] = useState("")
  const [officeLongitude, setOfficeLongitude] = useState("")
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(200)
  const [locatingOffice, setLocatingOffice] = useState(false)

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
      setGeofenceEnabled(!!organization.geofenceEnabled)
      setOfficeLatitude(organization.officeLatitude ?? "")
      setOfficeLongitude(organization.officeLongitude ?? "")
      setGeofenceRadiusMeters(organization.geofenceRadiusMeters ?? 200)
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

  const saveGeofence = useMutation({
    mutationFn: () =>
      api.patch("/organization", {
        geofenceEnabled,
        officeLatitude: officeLatitude === "" ? null : Number(officeLatitude),
        officeLongitude: officeLongitude === "" ? null : Number(officeLongitude),
        geofenceRadiusMeters: Number(geofenceRadiusMeters),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  })

  function useCurrentLocationAsOffice() {
    if (!navigator.geolocation) return
    setLocatingOffice(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOfficeLatitude(pos.coords.latitude.toFixed(7))
        setOfficeLongitude(pos.coords.longitude.toFixed(7))
        setLocatingOffice(false)
      },
      () => setLocatingOffice(false),
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const savePayrollAccount = useMutation({
    mutationFn: () => api.patch("/organization", { payrollBankName, payrollAccountNumber, lateDeductionAmount }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organization"] }),
  })

  const createSubOrganization = useMutation({
    mutationFn: () => api.post("/organization/suborganizations", { name: subOrganizationName.trim() }),
    onSuccess: async () => {
      setSubOrganizationName("")
      setOrganizationError("")
      await refreshUser()
    },
    onError: (err) => setOrganizationError(err.response?.data?.error || "Could not create organization"),
  })

  const removeSubOrganization = useMutation({
    mutationFn: (id) => api.delete(`/organization/suborganizations/${id}`),
    onSuccess: async (res, id) => {
      setOrganizationError("")
      queryClient.clear()
      if (organization?.id === id) {
        const main = (organizations || []).find((org) => org.isMain)
        if (main) await switchOrganization(main.id)
      }
      await refreshUser()
    },
    onError: (err) => setOrganizationError(err.response?.data?.error || "Could not remove organization"),
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

        <div className="card p-6 lg:col-span-2">
          <SectionHeader title="Company & Organizations" />
          <p className="mb-4 text-xs text-muted">
            {user?.role === "CEO" || user?.role === "ADMIN"
              ? "Manage the main company and its organizations from one account. Employees and HR stay limited to the organization they belong to."
              : "Your account is limited to its assigned organization."}
          </p>

          {(user?.role === "CEO" || user?.role === "ADMIN") ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {(organizations || []).map((org) => (
                  <div key={org.id} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{org.isMain ? org.name : `↳ ${org.name}`}</p>
                      <p className="truncate text-[11px] text-muted">{org.isMain ? "Main company" : "Sub-organization"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {organization?.id !== org.id && (
                        <button
                          type="button"
                          onClick={async () => {
                            queryClient.clear()
                            await switchOrganization(org.id)
                          }}
                          className="pill-secondary px-3 py-1.5 text-[11px]"
                        >
                          Open
                        </button>
                      )}
                      {!org.isMain && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Remove ${org.name}? It will be hidden from the company and its historical data will be preserved.`)) {
                              removeSubOrganization.mutate(org.id)
                            }
                          }}
                          disabled={removeSubOrganization.isPending}
                          className="rounded-xl border border-red-200 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 border-t border-border pt-5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add sub-organization</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={subOrganizationName}
                    onChange={(e) => { setSubOrganizationName(e.target.value); setOrganizationError("") }}
                    placeholder="e.g. AssetFlow Lahore Office"
                    className="field min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => createSubOrganization.mutate()}
                    disabled={!subOrganizationName.trim() || createSubOrganization.isPending}
                    className="pill-accent px-4 py-2.5 text-sm disabled:opacity-60"
                  >
                    {createSubOrganization.isPending ? "Creating…" : "Add organization"}
                  </button>
                </div>
                {organizationError && <p className="mt-2 text-xs text-chip-pink-fg">{organizationError}</p>}
              </div>
            </>
          ) : (
            <div className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">
              <span className="font-semibold text-ink">{organization?.name || "Your organization"}</span> is the only organization available to your role.
            </div>
          )}
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

        {(user?.role === "ADMIN" || isCeo) && (
          <div className="card p-6">
            <SectionHeader title="Attendance Geofence" />
            <p className="mb-4 text-xs text-muted">
              When enabled, office-based employees marking themselves Present outside this radius are
              automatically recorded as Absent with their location attached, until an admin reviews it on the
              Attendance page. Employees marked as a "Field" type in their profile are exempt.
            </p>
            <label className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={geofenceEnabled}
                onChange={(e) => setGeofenceEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border-strong"
              />
              Enable geofenced attendance
            </label>
            <div className="grid grid-cols-2 gap-4">
              <TextField
                label="Office latitude"
                type="number"
                step="0.0000001"
                value={officeLatitude}
                onChange={(e) => setOfficeLatitude(e.target.value)}
                placeholder="e.g. 31.5204"
              />
              <TextField
                label="Office longitude"
                type="number"
                step="0.0000001"
                value={officeLongitude}
                onChange={(e) => setOfficeLongitude(e.target.value)}
                placeholder="e.g. 74.3587"
              />
            </div>
            <button
              type="button"
              onClick={useCurrentLocationAsOffice}
              disabled={locatingOffice}
              className="pill-secondary mt-3 flex items-center gap-1.5 px-4 py-2 text-xs disabled:opacity-60"
            >
              <MapPin size={13} /> {locatingOffice ? "Locating…" : "Use my current location"}
            </button>
            <div className="mt-4">
              <TextField
                label="Allowed radius (meters)"
                type="number"
                min={20}
                max={20000}
                value={geofenceRadiusMeters}
                onChange={(e) => setGeofenceRadiusMeters(e.target.value)}
                hint="Distance from the office coordinates still counted as present"
              />
            </div>
            <button
              onClick={() => saveGeofence.mutate()}
              disabled={saveGeofence.isPending}
              className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {saveGeofence.isPending ? "Saving…" : "Save geofence"}
            </button>
            {saveGeofence.isSuccess && !saveGeofence.isPending && (
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
              <p className="mt-0.5 text-lg font-semibold text-ink">Free</p>
            </div>
            <span className="rounded-full bg-chip-green-bg px-3 py-1.5 text-[11px] font-semibold text-chip-green-fg">All features enabled</span>
          </div>
          <p className="mt-4 text-xs text-muted">
            Billing is currently disabled. Every AssetFlow feature is available to all organizations at no cost.
          </p>
        </div>
      </div>
    </div>
  )
}
