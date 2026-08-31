import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useAuth } from "../context/AuthContext"
import api from "../api/client"
import PageHeader from "../components/ui/PageHeader"
import SectionHeader from "../components/ui/SectionHeader"
import Avatar from "../components/ui/Avatar"
import { TextField } from "../components/ui/Field"
import { LogOut, Mail, Phone, Building2, Shield, User } from "lucide-react"

export default function Profile() {
  const { user, refreshUser, logout } = useAuth()

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [formError, setFormError] = useState("")
  const [success, setSuccess] = useState(false)

  const [contact, setContact] = useState({
    phone: user?.phone || "",
    email: user?.email || "",
  })

  const [contactError, setContactError] = useState("")
  const [contactSuccess, setContactSuccess] = useState(false)

  const changePassword = useMutation({
    mutationFn: () =>
      api.patch("/auth/password", {
        currentPassword,
        newPassword,
      }),

    onSuccess: () => {
      setSuccess(true)
      setFormError("")
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    },

    onError: (err) => {
      setSuccess(false)
      setFormError(
        err.response?.data?.error || "Could not update password"
      )
    },
  })

  const updateContact = useMutation({
    mutationFn: () =>
      api.patch(`/employees/${user.id}`, contact),

    onSuccess: () => {
      setContactSuccess(true)
      setContactError("")
      refreshUser()
    },

    onError: (err) => {
      setContactSuccess(false)
      setContactError(
        err.response?.data?.error ||
          "Could not update contact info"
      )
    },
  })

  function handleSubmit(e) {
    e.preventDefault()

    setFormError("")
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setFormError(
        "New password and confirmation don't match"
      )
      return
    }

    changePassword.mutate()
  }

  function handleContactSubmit(e) {
    e.preventDefault()

    setContactError("")
    setContactSuccess(false)

    updateContact.mutate()
  }

  return (
    <div className="min-h-full">
      <PageHeader
        title="Account"
        subtitle="Your profile and security."
        backTo="/"
      />

      {/* Main Profile Layout */}
      <div className="grid gap-5 lg:grid-cols-3">

        {/* =====================================================
            LEFT SIDE — PROFILE
        ====================================================== */}
        <div className="card p-6 lg:col-span-1">
          <div className="flex h-full flex-col">

            {/* Profile Header */}
            <div className="flex flex-col items-center text-center">
              <Avatar
                name={user?.name || "?"}
                size="xl"
              />

              <p
                className="mt-4 text-xl font-semibold text-ink"
                style={{ letterSpacing: "-0.025em" }}
              >
                {user?.name || "User"}
              </p>

              <p className="mt-1 text-sm text-muted">
                {user?.email || "—"}
              </p>

              <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-chip-blue-bg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-chip-blue-fg">
                <Shield size={12} />
                {user?.role || "USER"}
              </span>
            </div>

            {/* Divider */}
            <div className="my-7 border-t border-border" />

            {/* User Details */}
            <div className="space-y-5">

              <ProfileDetail
                icon={User}
                label="Full name"
                value={user?.name}
              />

              <ProfileDetail
                icon={Mail}
                label="Email"
                value={user?.email}
              />

              <ProfileDetail
                icon={Phone}
                label="Phone"
                value={user?.phone}
              />

              <ProfileDetail
                icon={Building2}
                label="Department"
                value={user?.department?.name}
              />

            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Logout */}
            <button
              type="button"
              onClick={logout}
              className="
                mt-8
                flex w-full
                items-center justify-center gap-2
                rounded-2xl
                border border-border
                px-4 py-3
                text-sm font-semibold
                text-muted
                transition-all duration-200
                hover:bg-chip-pink-bg
                hover:text-chip-pink-fg
              "
            >
              <LogOut size={16} />
              Logout
            </button>

          </div>
        </div>

        {/* =====================================================
            RIGHT SIDE — CONTACT + PASSWORD
        ====================================================== */}
        <div className="flex flex-col gap-5 lg:col-span-2">

          {/* =================================================
              CONTACT INFO
          ================================================== */}
          <div className="card p-6">
            <SectionHeader
              title="Contact Info"
            />

            <form
              onSubmit={handleContactSubmit}
              className="mt-5"
            >
              <div className="grid gap-5 sm:grid-cols-2">

                <TextField
                  label="Phone"
                  value={contact.phone}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      phone: e.target.value,
                    }))
                  }
                />

                <TextField
                  label="Email"
                  type="email"
                  value={contact.email}
                  onChange={(e) =>
                    setContact((c) => ({
                      ...c,
                      email: e.target.value,
                    }))
                  }
                  required
                />

              </div>

              {/* Contact Error */}
              {contactError && (
                <div className="mt-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-sm text-chip-pink-fg">
                  {contactError}
                </div>
              )}

              {/* Contact Success */}
              {contactSuccess && (
                <div className="mt-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-sm text-chip-green-fg">
                  Contact info updated successfully.
                </div>
              )}

              {/* Save Button */}
              <div className="mt-5">
                <button
                  type="submit"
                  disabled={updateContact.isPending}
                  className="
                    pill-accent
                    px-5 py-2.5
                    text-sm
                    disabled:opacity-60
                  "
                >
                  {updateContact.isPending
                    ? "Saving…"
                    : "Save contact info"}
                </button>
              </div>
            </form>
          </div>

          {/* =================================================
              CHANGE PASSWORD
          ================================================== */}
          <div className="card p-6">
            <SectionHeader
              title="Change Password"
            />

            <form
              onSubmit={handleSubmit}
              className="mt-5"
            >
              <div className="grid gap-5 sm:grid-cols-2">

                {/* Current Password */}
                <div className="sm:col-span-2">
                  <TextField
                    label="Current password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) =>
                      setCurrentPassword(e.target.value)
                    }
                    required
                    autoComplete="current-password"
                  />
                </div>

                {/* New Password */}
                <TextField
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={(e) =>
                    setNewPassword(e.target.value)
                  }
                  required
                  minLength={8}
                  autoComplete="new-password"
                />

                {/* Confirm Password */}
                <TextField
                  label="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) =>
                    setConfirmPassword(e.target.value)
                  }
                  required
                  minLength={8}
                  autoComplete="new-password"
                />

              </div>

              {/* Password Error */}
              {formError && (
                <div className="mt-4 rounded-2xl bg-chip-pink-bg px-4 py-3 text-sm text-chip-pink-fg">
                  {formError}
                </div>
              )}

              {/* Password Success */}
              {success && (
                <div className="mt-4 rounded-2xl bg-chip-green-bg px-4 py-3 text-sm text-chip-green-fg">
                  Password updated successfully.
                </div>
              )}

              {/* Update Button */}
              <div className="mt-5">
                <button
                  type="submit"
                  disabled={changePassword.isPending}
                  className="
                    pill-accent
                    px-5 py-2.5
                    text-sm
                    disabled:opacity-60
                  "
                >
                  {changePassword.isPending
                    ? "Updating…"
                    : "Update password"}
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  )
}

/* ============================================================
   PROFILE DETAIL COMPONENT
============================================================ */

function ProfileDetail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3">

      <div
        className="
          flex h-9 w-9 shrink-0
          items-center justify-center
          rounded-xl
          bg-black/[0.035]
          text-muted
        "
      >
        <Icon size={16} strokeWidth={1.8} />
      </div>

      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </p>

        <p className="mt-0.5 truncate text-sm font-medium text-ink">
          {value || "—"}
        </p>
      </div>

    </div>
  )
}