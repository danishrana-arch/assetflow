import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useAuth } from "../context/AuthContext"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import Avatar from "../components/ui/Avatar"
import { TextField } from "../components/ui/Field"
import { LogOut } from "lucide-react"

export default function Profile() {
  const { user, refreshUser, logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [formError, setFormError] = useState("")
  const [success, setSuccess] = useState(false)

  const [contact, setContact] = useState({ phone: user?.phone || "", email: user?.email || "" })
  const [contactError, setContactError] = useState("")
  const [contactSuccess, setContactSuccess] = useState(false)

  const changePassword = useMutation({
    mutationFn: () => api.patch("/auth/password", { currentPassword, newPassword }),
    onSuccess: () => {
      setSuccess(true); setFormError("")
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
    },
    onError: (err) => {
      setSuccess(false)
      setFormError(err.response?.data?.error || "Could not update password")
    },
  })

  const updateContact = useMutation({
    mutationFn: () => api.patch(`/employees/${user.id}`, contact),
    onSuccess: () => {
      setContactSuccess(true); setContactError("")
      refreshUser()
    },
    onError: (err) => {
      setContactSuccess(false)
      setContactError(err.response?.data?.error || "Could not update contact info")
    },
  })

  function handleSubmit(e) {
    e.preventDefault()
    setFormError(""); setSuccess(false)
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation don't match")
      return
    }
    changePassword.mutate()
  }

  function handleContactSubmit(e) {
    e.preventDefault()
    setContactError(""); setContactSuccess(false)
    updateContact.mutate()
  }

  return (
    <div>
      <PageHeader title="Account" subtitle="Your profile and security." backTo="/" />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <Avatar name={user?.name || "?"} size="xl" />
            <p className="mt-3 text-lg font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>
              {user?.name}
            </p>
            <p className="text-sm text-muted">{user?.email}</p>
            <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-chip-blue-bg px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-chip-blue-fg">
              {user?.role}
            </span>
          </div>
          <div className="mt-6 space-y-2 border-t border-border pt-4 text-sm">
            <Detail label="Department" value={user?.department?.name} />
            <Detail label="Phone" value={user?.phone} />
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-muted transition hover:bg-chip-pink-bg hover:text-chip-pink-fg lg:hidden"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>

        <div className="card p-6 lg:col-span-2">
          <SectionHeader title="Contact Info" />
          <form onSubmit={handleContactSubmit} className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Phone"
              value={contact.phone}
              onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
            />
            <TextField
              label="Email"
              type="email"
              value={contact.email}
              onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
              required
            />
            {contactError && (
              <div className="sm:col-span-2 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
                {contactError}
              </div>
            )}
            {contactSuccess && (
              <div className="sm:col-span-2 rounded-2xl bg-chip-green-bg px-3.5 py-2.5 text-sm text-chip-green-fg">
                Contact info updated.
              </div>
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={updateContact.isPending}
                className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {updateContact.isPending ? "Saving…" : "Save contact info"}
              </button>
            </div>
          </form>
        </div>

        <div className="card p-6 lg:col-span-2">
          <SectionHeader title="Change Password" />
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Current password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="sm:col-span-2"
            />
            <TextField
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            {formError && (
              <div className="sm:col-span-2 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
                {formError}
              </div>
            )}
            {success && (
              <div className="sm:col-span-2 rounded-2xl bg-chip-green-bg px-3.5 py-2.5 text-sm text-chip-green-fg">
                Password updated.
              </div>
            )}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={changePassword.isPending}
                className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60"
              >
                {changePassword.isPending ? "Updating…" : "Update password"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-medium text-ink">{value || "—"}</span>
    </div>
  )
}
