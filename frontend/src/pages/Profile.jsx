import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useAuth } from "../context/AuthContext"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import ProfilePhoto from "../components/ProfilePhoto"
import { roleLabel } from "../utils/roles"
import {
  LogOut, Mail, Phone, Building2, Briefcase, CalendarDays, BadgeCheck,
  Shield, Eye, EyeOff, Check, KeyRound, UserRound, ArrowLeftRight,
} from "lucide-react"

// The signed-in user's own page (header profile badge → /profile): just the main
// facts about them plus changing their password. Everything else about an
// employee lives on /employees/:id, which management edits.
export default function Profile() {
  const { user, organization, organizations, logout } = useAuth()

  // The session (/auth/me) leaves out profile details like phone, department,
  // joining date and employment status, so read them from the user's own
  // employee record (always allowed for yourself). Same key as
  // EmployeeProfile, so the two share the cache.
  const { data: employee } = useQuery({
    queryKey: ["employee", user?.id],
    queryFn: () => api.get(`/employees/${user.id}`).then((r) => r.data),
    enabled: Boolean(user?.id),
  })
  const me = { ...user, ...(employee || {}) }

  // Company = the one they belong to. If they've switched to another company
  // in the header selector (CEO / Admin / IT), that one is shown as well.
  const homeId = employee?.organizationId || user?.homeOrganizationId
  const homeCompany =
    employee?.organization?.name ||
    organizations?.find((org) => org.id === homeId)?.name ||
    (organization?.id === homeId ? organization?.name : null)
  const viewingCompany = organization && homeId && organization.id !== homeId ? organization.name : null

  const joined = me.joiningDate || me.startDate
  const employment =
    me.employmentStatus === "PERMANENT" ? "Permanent" : me.employmentStatus === "PROBATION" ? "Probation" : null
  const role = roleLabel(user?.role) || "User"
  const designation =
    me.designation && me.designation.toLowerCase() !== role.toLowerCase() ? me.designation : null

  return (
    <div className="min-h-full">
      <PageHeader title="My Profile" subtitle="Your main information and password." backTo="/" />

      <div className="flex flex-col gap-5">
        {/* Identity */}
        <div className="card flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <ProfilePhoto employeeId={user?.id} name={user?.name || "?"} src={me.photoUrl} size="xl" canEdit={Boolean(user?.id)} className="self-start rounded-full" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold text-ink" style={{ letterSpacing: "-0.025em" }}>
              {user?.name || "User"}
            </p>
            <p className="mt-1 text-sm text-muted sm:truncate">
              {[designation, me.department?.name, homeCompany].filter(Boolean).join(" · ") || user?.email}
            </p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-chip-blue-bg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-chip-blue-fg">
              <Shield size={12} />
              {role}
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex items-center justify-center gap-2 rounded-2xl border border-border px-5 py-2.5 text-sm font-semibold text-muted transition-all duration-200 hover:bg-chip-pink-bg hover:text-chip-pink-fg"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>

        <div className="grid items-stretch gap-5 lg:grid-cols-2">
          {/* Main information */}
          <div className="card flex flex-col p-6">
            <CardTitle icon={UserRound} title="Main information" subtitle="Ask HR if anything here needs to change." />
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {/* Rows always pair up: Email and Company take a full row, except that
                  Company shares its row with "Currently viewing" after a switch. */}
              <ProfileDetail icon={Mail} label="Email" value={me.email} wrap className="sm:col-span-2" />
              <ProfileDetail icon={Building2} label="Company" value={homeCompany} className={viewingCompany ? "" : "sm:col-span-2"} />
              {viewingCompany && <ProfileDetail icon={ArrowLeftRight} label="Currently viewing" value={viewingCompany} />}
              <ProfileDetail icon={Phone} label="Phone" value={me.phone} />
              <ProfileDetail icon={Briefcase} label="Department" value={me.department?.name} />
              <ProfileDetail
                icon={CalendarDays}
                label="Joined"
                value={
                  joined
                    ? new Date(joined).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
                    : null
                }
              />
              <ProfileDetail icon={BadgeCheck} label="Employment" value={employment} />
            </div>
          </div>

          <ChangePasswordCard email={user?.email} />
        </div>
      </div>
    </div>
  )
}

function CardTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-ink">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="section-title">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
    </div>
  )
}

function ChangePasswordCard({ email }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" })
  const [error, setError] = useState("")
  const [success, setSuccess] = useState(false)

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setSuccess(false)
  }

  const rules = [
    { ok: form.next.length >= 8, text: "At least 8 characters" },
    { ok: form.next.length > 0 && form.next !== form.current, text: "Different from your current password" },
    { ok: form.confirm.length > 0 && form.next === form.confirm, text: "New password and confirmation match" },
  ]
  const canSubmit = form.current.length > 0 && rules.every((r) => r.ok)

  const changePassword = useMutation({
    mutationFn: () => api.patch("/auth/password", { currentPassword: form.current, newPassword: form.next }),
    onSuccess: () => {
      setSuccess(true)
      setError("")
      setForm({ current: "", next: "", confirm: "" })
    },
    onError: (err) => {
      setSuccess(false)
      setError(err.response?.data?.error || "Could not update password")
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    setError("")
    setSuccess(false)
    if (canSubmit) changePassword.mutate()
  }

  return (
    <div className="card flex flex-col p-6">
      <CardTitle icon={KeyRound} title="Change password" subtitle="Forgot it? Ask HR or an Admin to reset it." />

      <form onSubmit={handleSubmit} className="mt-6 flex flex-1 flex-col gap-5">
        {/* Lets password managers know which account this password is for. */}
        <input type="text" name="username" autoComplete="username" value={email || ""} readOnly hidden />
        <PasswordField label="Current password" value={form.current} onChange={set("current")} autoComplete="current-password" />
        <div className="grid gap-5 sm:grid-cols-2">
          <PasswordField label="New password" value={form.next} onChange={set("next")} autoComplete="new-password" />
          <PasswordField label="Confirm new password" value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
        </div>

        <ul className="space-y-1.5">
          {rules.map((rule) => (
            <li key={rule.text} className={`flex items-center gap-2 text-sm ${rule.ok ? "text-chip-green-fg" : "text-muted"}`}>
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                  rule.ok ? "bg-chip-green-bg" : "border border-border"
                }`}
              >
                {rule.ok && <Check size={11} strokeWidth={3} />}
              </span>
              {rule.text}
            </li>
          ))}
        </ul>

        {error && <div className="rounded-2xl bg-chip-pink-bg px-4 py-3 text-sm text-chip-pink-fg">{error}</div>}
        {success && (
          <div className="rounded-2xl bg-chip-green-bg px-4 py-3 text-sm text-chip-green-fg">
            Password updated. Use your new password next time you sign in.
          </div>
        )}

        <div className="mt-auto">
          <button
            type="submit"
            disabled={!canSubmit || changePassword.isPending}
            className="pill-accent px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {changePassword.isPending ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </div>
  )
}

function PasswordField({ label, value, onChange, autoComplete }) {
  const [visible, setVisible] = useState(false)
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="relative block">
        <input
          type={visible ? "text" : "password"}
          className="field pr-11"
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-black/5 hover:text-ink"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  )
}

function ProfileDetail({ icon: Icon, label, value, wrap = false, className = "" }) {
  return (
    <div className={`flex min-w-0 items-center gap-3 rounded-2xl border border-border p-3.5 ${className}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center text-ink">
        <Icon size={16} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-0.5 text-sm font-medium text-ink ${wrap ? "break-all" : "truncate"}`} title={value || undefined}>
          {value || "—"}
        </p>
      </div>
    </div>
  )
}
