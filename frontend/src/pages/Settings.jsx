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
import { TIMEZONE_GROUPS, timezoneLabel } from "../utils/timezones"
import { formatClock } from "../utils/time"
import { roleLabel } from "../utils/roles"
import OfficeLocationMap from "../components/OfficeLocationMap"

const ATTENDANCE_PERMISSION_FIELDS = ["canCreate", "canRead", "canUpdate", "canDelete"]

const PRESETS = [
  { label: "Blue", value: "#3B82F6" },
  { label: "Violet", value: "#8B5CF6" },
  { label: "Cyan", value: "#06B6D4" },
  { label: "Emerald", value: "#16A34A" },
  { label: "Amber", value: "#F59E0B" },
  { label: "Pink", value: "#EC4899" },
  { label: "Slate", value: "#0F172A" },
]

// Monday-first, values = JS/UTC weekday numbers stored in Organization.workingDays.
const WEEKDAYS = [[1, "Mon", "Monday"], [2, "Tue", "Tuesday"], [3, "Wed", "Wednesday"], [4, "Thu", "Thursday"], [5, "Fri", "Friday"], [6, "Sat", "Saturday"], [0, "Sun", "Sunday"]]

function parseWorkingDays(organization) {
  const raw = organization?.workingDays
  if (typeof raw === "string" && raw.trim()) {
    const days = raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    if (days.length) return days
  }
  const n = Number(organization?.workingDaysPerWeek ?? 5)
  return n >= 7 ? [0, 1, 2, 3, 4, 5, 6] : Array.from({ length: Math.max(1, n) }, (_, i) => i + 1)
}

export default function Settings() {
  const { user, organizations, refreshUser, switchOrganization } = useAuth()
  const isCeo = user?.role === "CEO"
  const canEditSchedule = ["ADMIN", "CEO"].includes(user?.role)
  const queryClient = useQueryClient()
  const { applyAccent } = useTheme()
  const [name, setName] = useState("")
  const [primaryColor, setPrimaryColor] = useState("#3B82F6")
  const [payrollBankName, setPayrollBankName] = useState("")
  const [payrollAccountNumber, setPayrollAccountNumber] = useState("")
  const [workingHoursPerDay, setWorkingHoursPerDay] = useState(8)
  // Working weekdays, 0 Sunday … 6 Saturday (Organization.workingDays).
  const [workingDays, setWorkingDays] = useState([1, 2, 3, 4, 5])
  const [shiftStartDefault, setShiftStartDefault] = useState("09:00")
  const [lateThresholdMinutes, setLateThresholdMinutes] = useState(15)
  const [shiftEndDefault, setShiftEndDefault] = useState("18:00")
  const [timezone, setTimezone] = useState("Asia/Karachi")
  const [breakStart, setBreakStart] = useState("")
  const [breakEnd, setBreakEnd] = useState("")
  const [subOrganizationName, setSubOrganizationName] = useState("")
  const [organizationError, setOrganizationError] = useState("")
  const [geofenceEnabled, setGeofenceEnabled] = useState(false)
  const [officeLatitude, setOfficeLatitude] = useState("")
  const [officeLongitude, setOfficeLongitude] = useState("")
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(200)
  const [locatingOffice, setLocatingOffice] = useState(false)
  const [brandingError, setBrandingError] = useState("")
  const [scheduleError, setScheduleError] = useState("")
  const [geofenceError, setGeofenceError] = useState("")
  const [payrollError, setPayrollError] = useState("")
  const [attendanceMatrix, setAttendanceMatrix] = useState([])
  const [permissionsError, setPermissionsError] = useState("")
  const isOwnerTier = user?.role === "ADMIN" || user?.role === "CEO"

  const { data: organization } = useQuery({
    queryKey: ["organization"],
    queryFn: () => api.get("/organization").then((r) => r.data),
  })

  useEffect(() => {
    if (organization) {
      setName(organization.name || "")
      setPrimaryColor(organization.primaryColor || "#3B82F6")
      setPayrollBankName(organization.payrollBankName || "")
      setPayrollAccountNumber(organization.payrollAccountNumber || "")
      setWorkingHoursPerDay(organization.workingHoursPerDay ?? 8)
      setWorkingDays(parseWorkingDays(organization))
      setShiftStartDefault(organization.shiftStartDefault || "09:00")
      setShiftEndDefault(organization.shiftEndDefault || "18:00")
      setLateThresholdMinutes(organization.lateThresholdMinutes ?? 15)
      setTimezone(organization.timezone || "Asia/Karachi")
      setBreakStart(organization.breakStart || "")
      setBreakEnd(organization.breakEnd || "")
      setGeofenceEnabled(!!organization.geofenceEnabled)
      setOfficeLatitude(organization.officeLatitude ?? "")
      setOfficeLongitude(organization.officeLongitude ?? "")
      setGeofenceRadiusMeters(organization.geofenceRadiusMeters ?? 200)
      // Clear any error left over from a previous organization — otherwise a
      // stale message from company A stays on screen after switching to B.
      setBrandingError("")
      setScheduleError("")
      setGeofenceError("")
      setPayrollError("")
      setPermissionsError("")
    }
  }, [organization])

  const { data: attendancePermissions } = useQuery({
    queryKey: ["attendance-permissions"],
    queryFn: () => api.get("/organization/attendance-permissions").then((r) => r.data),
    enabled: isOwnerTier,
  })

  useEffect(() => {
    if (attendancePermissions) setAttendanceMatrix(attendancePermissions)
  }, [attendancePermissions])

  const saveAttendancePermissions = useMutation({
    mutationFn: () => api.put("/organization/attendance-permissions", { permissions: attendanceMatrix }),
    onSuccess: () => {
      setPermissionsError("")
      queryClient.invalidateQueries({ queryKey: ["attendance-permissions"] })
    },
    onError: (err) => setPermissionsError(err.response?.data?.error || "Could not save — please try again"),
  })

  function toggleAttendancePermission(role, field) {
    setAttendanceMatrix((prev) => prev.map((row) => (row.role === role ? { ...row, [field]: !row[field] } : row)))
  }

  const save = useMutation({
    mutationFn: () => api.patch("/organization", { name, primaryColor }),
    onSuccess: (res) => {
      setBrandingError("")
      queryClient.invalidateQueries({ queryKey: ["organization"] })
      applyAccent(res.data.primaryColor)
    },
    onError: (err) => setBrandingError(err.response?.data?.error || "Could not save — please try again"),
  })

  const saveWorkSchedule = useMutation({
    mutationFn: () => api.patch("/organization", { workingHoursPerDay, workingDays, shiftStartDefault, shiftEndDefault, lateThresholdMinutes, timezone, breakStart: breakStart || null, breakEnd: breakEnd || null }),
    onSuccess: () => {
      setScheduleError("")
      queryClient.invalidateQueries({ queryKey: ["organization"] })
    },
    onError: (err) => setScheduleError(err.response?.data?.error || "Could not save — please try again"),
  })

  const saveGeofence = useMutation({
    mutationFn: () =>
      api.patch("/organization", {
        geofenceEnabled,
        officeLatitude: officeLatitude === "" ? null : Number(officeLatitude),
        officeLongitude: officeLongitude === "" ? null : Number(officeLongitude),
        geofenceRadiusMeters: Number(geofenceRadiusMeters),
      }),
    onSuccess: () => {
      setGeofenceError("")
      queryClient.invalidateQueries({ queryKey: ["organization"] })
    },
    onError: (err) => setGeofenceError(err.response?.data?.error || "Could not save — please try again"),
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
    mutationFn: () => api.patch("/organization", { payrollBankName, payrollAccountNumber }),
    onSuccess: () => {
      setPayrollError("")
      queryClient.invalidateQueries({ queryKey: ["organization"] })
    },
    onError: (err) => setPayrollError(err.response?.data?.error || "Could not save — please try again"),
  })

  // Companies are all equal. Only a CEO adds / removes companies and decides
  // which Admins / IT Managers may open which company (backend
  // utils/organization.js). Everyone else just sees the companies they reach.
  const canManageCompanies = !!user?.canManageCompanies
  const [companyError, setCompanyError] = useState("")
  const createSubOrganization = useMutation({
    mutationFn: () => api.post("/organization/suborganizations", { name: subOrganizationName.trim() }),
    onSuccess: async () => {
      setSubOrganizationName("")
      setOrganizationError("")
      await refreshUser()
    },
    onError: (err) => setOrganizationError(err.response?.data?.error || "Could not add the company"),
  })
  // Every Admin / IT Manager of the group with their grantedOrganizationIds.
  const { data: accessUsers = [] } = useQuery({
    queryKey: ["organization-access-users"],
    queryFn: () => api.get("/organization/access-users").then((r) => r.data),
    enabled: canManageCompanies,
  })
  const setCompanyAccess = useMutation({
    mutationFn: ({ orgId, userId, enabled }) => (enabled
      ? api.post(`/organization/company/${orgId}/access`, { userId })
      : api.delete(`/organization/company/${orgId}/access/${userId}`)),
    onSuccess: () => {
      setCompanyError("")
      queryClient.invalidateQueries({ queryKey: ["organization-access-users"] })
    },
    onError: (err) => setCompanyError(err.response?.data?.error || "Could not change company access"),
  })
  const ROLE_SHORT = { ADMIN: "Admin", IT_MANAGER: "IT" }

  const removeSubOrganization = useMutation({
    mutationFn: (id) => api.delete(`/organization/suborganizations/${id}`),
    onSuccess: async (res, id) => {
      setOrganizationError("")
      queryClient.clear()
      if (organization?.id === id) {
        const home = (organizations || []).find((org) => org.id === user?.homeOrganizationId) || (organizations || [])[0]
        if (home) await switchOrganization(home.id)
      }
      await refreshUser()
    },
    onError: (err) => setOrganizationError(err.response?.data?.error || "Could not remove organization"),
  })

  return (
    <div>
      <PageHeader title="Organization Settings" subtitle="Configure how your workspace looks and behaves." backTo="/" />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card min-w-0 p-6">
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
            {save.isSuccess && !save.isPending && !brandingError && (
              <p className="text-xs text-chip-green-fg">Saved.</p>
            )}
            {brandingError && <p className="text-xs text-chip-pink-fg">{brandingError}</p>}
          </div>
        </div>

        <div className="card min-w-0 p-6">
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
          </div>
          <button
            onClick={() => savePayrollAccount.mutate()}
            disabled={savePayrollAccount.isPending}
            className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
          >
            {savePayrollAccount.isPending ? "Saving…" : "Save payroll account"}
          </button>
          {savePayrollAccount.isSuccess && !savePayrollAccount.isPending && !payrollError && (
            <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
          )}
          {payrollError && <p className="mt-2 text-xs text-chip-pink-fg">{payrollError}</p>}
        </div>

        <div className="card min-w-0 p-6 lg:col-span-2">
          <SectionHeader title="Companies & Access" />
          <p className="mb-4 text-xs text-muted">
            {canManageCompanies
              ? "All companies are equal. CEOs open every company; an Admin or IT Manager opens their own company plus the ones you give them below. HR and everyone else stay in their own company."
              : isOwnerTier
                ? "The companies you can open. Only a CEO can add companies or change who has access."
                : "Your account is limited to its assigned organization."}
          </p>

          {isOwnerTier ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {(organizations || []).map((org) => {
                  const granted = accessUsers.filter((u) => u.grantedOrganizationIds?.includes(org.id))
                  const grantable = accessUsers.filter((u) => u.organization?.id !== org.id && !u.grantedOrganizationIds?.includes(org.id))
                  return (
                    <div key={org.id} className="flex min-w-0 items-start justify-between gap-3 rounded-2xl border border-border bg-surface-2 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink">
                          {org.name}
                        </p>
                        {canManageCompanies && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {granted.map((u) => (
                              <span key={u.id} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink">
                                {u.name} · {ROLE_SHORT[u.role]}
                                <button
                                  type="button"
                                  onClick={() => setCompanyAccess.mutate({ orgId: org.id, userId: u.id, enabled: false })}
                                  disabled={setCompanyAccess.isPending}
                                  className="text-muted hover:text-red-600 dark:hover:text-red-300"
                                  aria-label={`Remove ${u.name}'s access to ${org.name}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            {grantable.length > 0 && (
                              <select
                                value=""
                                onChange={(e) => e.target.value && setCompanyAccess.mutate({ orgId: org.id, userId: e.target.value, enabled: true })}
                                disabled={setCompanyAccess.isPending}
                                className="max-w-[170px] rounded-lg border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted disabled:opacity-60"
                                aria-label={`Give someone access to ${org.name}`}
                              >
                                <option value="">+ Give access…</option>
                                {grantable.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_SHORT[u.role]}, {u.organization?.name})</option>)}
                              </select>
                            )}
                            {!granted.length && !grantable.length && <span className="text-[10px] text-muted">CEOs only</span>}
                          </div>
                        )}
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
                        {canManageCompanies && org.id !== user?.homeOrganizationId && (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(`Remove ${org.name}? It will be hidden from every selector, anyone given access loses it, and its historical data is kept.`)) {
                                removeSubOrganization.mutate(org.id)
                              }
                            }}
                            disabled={removeSubOrganization.isPending}
                            className="rounded-xl border border-red-200 dark:border-red-400/30 px-3 py-1.5 text-[11px] font-semibold text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {companyError && <p className="mt-2 text-xs text-chip-pink-fg">{companyError}</p>}

              {canManageCompanies && (
                <div className="mt-5 border-t border-border pt-5">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Add company</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={subOrganizationName}
                      onChange={(e) => { setSubOrganizationName(e.target.value); setOrganizationError("") }}
                      placeholder="e.g. ManagementDock Lahore Office"
                      className="field min-w-0 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => createSubOrganization.mutate()}
                      disabled={!subOrganizationName.trim() || createSubOrganization.isPending}
                      className="pill-accent px-4 py-2.5 text-sm disabled:opacity-60"
                    >
                      {createSubOrganization.isPending ? "Adding…" : "Add company"}
                    </button>
                  </div>
                  {organizationError && <p className="mt-2 text-xs text-chip-pink-fg">{organizationError}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl bg-surface-2 p-4 text-sm text-muted">
              <span className="font-semibold text-ink">{organization?.name || "Your organization"}</span> is the only organization available to your role.
            </div>
          )}
        </div>

        {canEditSchedule && (
          <div className="card min-w-0 p-6">
            <SectionHeader title="Work Schedule & Time Zone" />
            <p className="mb-4 text-xs text-muted">
              These values drive attendance, leave and payroll. Days that aren't working days (e.g. the weekend) are never counted as leave or absent.
            </p>
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Working days</p>
              <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Working days">
                {WEEKDAYS.map(([day, short, long]) => {
                  const on = workingDays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      title={`${long}: ${on ? "working day" : "day off"}`}
                      onClick={() => setWorkingDays((d) => (on ? d.filter((x) => x !== day) : [...d, day].sort((a, b) => a - b)))}
                      className={`flex flex-col items-center rounded-xl border px-1 py-2 text-xs font-semibold transition-colors ${on ? "border-accent bg-accent text-on-accent" : "border-border-strong bg-surface text-muted hover:text-ink"}`}
                    >
                      {short}
                      <span className={`mt-0.5 text-[9px] font-medium ${on ? "opacity-80" : "text-muted-2"}`}>{on ? "Work" : "Off"}</span>
                    </button>
                  )
                })}
              </div>
              <p className={`mt-1.5 text-[11px] ${workingDays.length ? "text-muted-2" : "text-chip-pink-fg"}`}>
                {workingDays.length
                  ? `${workingDays.length} working day${workingDays.length === 1 ? "" : "s"} a week · off: ${WEEKDAYS.filter(([d]) => !workingDays.includes(d)).map(([, , l]) => l).join(", ") || "none"}. A weekend inside a leave isn't counted as leave.`
                  : "Pick at least one working day."}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Working hours / day"
                type="number"
                min={1}
                max={24}
                step="0.5"
                value={workingHoursPerDay}
                onChange={(e) => setWorkingHoursPerDay(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
              <TextField
                label="Default shift start"
                type="time"
                value={shiftStartDefault}
                hint={formatClock(shiftStartDefault)}
                onChange={(e) => setShiftStartDefault(e.target.value)}
              />
              <TextField
                label="Late threshold (minutes)"
                type="number"
                min={0}
                max={480}
                value={lateThresholdMinutes}
                onChange={(e) => setLateThresholdMinutes(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mt-4">
              <TextField
                label="Default shift end"
                type="time"
                value={shiftEndDefault}
                hint={formatClock(shiftEndDefault)}
                onChange={(e) => setShiftEndDefault(e.target.value)}
              />
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">Organization time zone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="field w-full">
                  {TIMEZONE_GROUPS.map(([region, zones]) => (
                    <optgroup key={region} label={region}>
                      {zones.map((zone) => (
                        <option key={zone} value={zone}>{timezoneLabel(zone)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Office break</p>
              <p className="mt-1 text-xs text-muted">Punches during this period are ignored for check-in/check-out purposes. The break remains part of office time, so a checkout during the break cannot become the employee's timeout.</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField label="Break start" type="time" value={breakStart} hint={formatClock(breakStart)} onChange={(e) => setBreakStart(e.target.value)} />
                <TextField label="Break end" type="time" value={breakEnd} hint={formatClock(breakEnd)} onChange={(e) => setBreakEnd(e.target.value)} />
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-2">
              Expected weekly time: {(Number(workingHoursPerDay || 0) * workingDays.length).toFixed(1)} hours.
            </p>
            <button
              onClick={() => saveWorkSchedule.mutate()}
              disabled={saveWorkSchedule.isPending || workingDays.length === 0}
              className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {saveWorkSchedule.isPending ? "Saving…" : "Save work schedule"}
            </button>
            {saveWorkSchedule.isSuccess && !saveWorkSchedule.isPending && !scheduleError && (
              <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
            )}
            {scheduleError && <p className="mt-2 text-xs text-chip-pink-fg">{scheduleError}</p>}
          </div>
        )}

        {isOwnerTier && (
          <div className="card min-w-0 p-6">
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

            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Office location</p>
              <OfficeLocationMap
                latitude={officeLatitude}
                longitude={officeLongitude}
                radiusMeters={geofenceRadiusMeters}
                onChange={({ latitude, longitude }) => {
                  setOfficeLatitude(latitude)
                  setOfficeLongitude(longitude)
                }}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
            {saveGeofence.isSuccess && !saveGeofence.isPending && !geofenceError && (
              <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
            )}
            {geofenceError && <p className="mt-2 text-xs text-chip-pink-fg">{geofenceError}</p>}
          </div>
        )}

        {isOwnerTier && (
          <div className="card min-w-0 p-6 lg:col-span-2">
            <SectionHeader title="Attendance permission matrix" />
            <p className="mb-4 text-xs text-muted">
              Choose exactly what each role can do on the Attendance page. ADMIN, CEO and MANAGER always have full
              access and aren't shown here they can't be downgraded.
            </p>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="bg-surface-2 text-muted">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Role</th>
                    <th className="px-3 py-3 text-center">Create</th>
                    <th className="px-3 py-3 text-center">Read</th>
                    <th className="px-3 py-3 text-center">Update</th>
                    <th className="px-3 py-3 text-center">Delete</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {attendanceMatrix.map((row) => (
                    <tr key={row.role}>
                      <td className="px-3 py-3 font-semibold text-ink">{roleLabel(row.role)}</td>
                      {ATTENDANCE_PERMISSION_FIELDS.map((field) => (
                        <td key={field} className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={!!row[field]}
                            onChange={() => toggleAttendancePermission(row.role, field)}
                            className="h-4 w-4 rounded border-border-strong"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!attendanceMatrix.length && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">Loading…</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              onClick={() => saveAttendancePermissions.mutate()}
              disabled={saveAttendancePermissions.isPending}
              className="pill-accent mt-4 px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {saveAttendancePermissions.isPending ? "Saving…" : "Save permissions"}
            </button>
            {saveAttendancePermissions.isSuccess && !saveAttendancePermissions.isPending && !permissionsError && (
              <p className="mt-2 text-xs text-chip-green-fg">Saved.</p>
            )}
            {permissionsError && <p className="mt-2 text-xs text-chip-pink-fg">{permissionsError}</p>}
          </div>
        )}

        <div className="card min-w-0 p-6 lg:col-span-2">
          <SectionHeader title="Plan & Shortcuts" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Plan & billing</p>
                <p className="mt-0.5 text-lg font-semibold text-ink">Billing & Subscription</p>
                <p className="mt-1 text-xs text-muted">See your plan, employee usage and invoices, or change plan.</p>
              </div>
              <Link to="/billing" className="pill-accent shrink-0 px-4 py-2 text-xs">Open billing</Link>
            </div>
            <div className="rounded-2xl bg-surface-2 p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Shortcuts</p>
              <div className="flex flex-wrap gap-2">
                <Link to="/leave-requests" className="pill-secondary px-4 py-2 text-xs">Leave Policy</Link>
                <Link to="/announcements?tab=holidays" className="pill-secondary px-4 py-2 text-xs">Manage Holidays</Link>
                <Link to="/settings/attendance-devices" className="pill-secondary px-4 py-2 text-xs">Attendance Devices</Link>
                <Link to="/audit-log" className="pill-secondary px-4 py-2 text-xs">View Audit Log</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
