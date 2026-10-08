import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import Modal from "../billing/Modal"
import { TextField } from "../ui/Field"
import api from "../../api/client"
import { errorMessage } from "./shared"

// Change your own password (PATCH /auth/password). The platform account holds
// the keys to every company, so it requires 12+ characters.
export default function ChangePasswordDialog({ onClose }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" })
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const checks = [
    ["At least 12 characters", form.next.length >= 12],
    ["Different from the current password", form.next !== "" && form.next !== form.current],
    ["Both new passwords match", form.next !== "" && form.next === form.confirm],
  ]
  const valid = form.current !== "" && checks.every(([, ok]) => ok)

  const save = useMutation({
    mutationFn: () => api.patch("/auth/password", { currentPassword: form.current, newPassword: form.next }).then((r) => r.data),
    onSuccess: () => setDone(true),
    onError: (err) => setError(errorMessage(err)),
  })

  return (
    <Modal
      title="Change password"
      subtitle={done ? undefined : "Use a long, unique password."}
      onClose={onClose}
      busy={save.isPending}
      footer={
        done ? (
          <button type="button" onClick={onClose} className="pill-accent px-5 py-2.5 text-sm">Done</button>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={save.isPending} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
            <button type="submit" form="platform-pw-form" disabled={!valid || save.isPending} className="pill-accent px-5 py-2.5 text-sm">{save.isPending ? "Saving…" : "Update password"}</button>
          </>
        )
      }
    >
      {done ? (
        <p className="pb-2 text-sm text-ink">Your password was updated. Use it the next time you sign in.</p>
      ) : (
        <form id="platform-pw-form" onSubmit={(e) => { e.preventDefault(); setError(""); save.mutate() }} className="space-y-3 pb-2">
          <TextField label="Current password" type="password" autoComplete="current-password" value={form.current} onChange={(e) => set({ current: e.target.value })} autoFocus />
          <TextField label="New password" type="password" autoComplete="new-password" value={form.next} onChange={(e) => set({ next: e.target.value })} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set({ confirm: e.target.value })} />
          <ul className="space-y-0.5 text-xs">
            {checks.map(([text, ok]) => <li key={text} className={ok ? "text-success" : "text-muted"}>{ok ? "✓" : "○"} {text}</li>)}
          </ul>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </Modal>
  )
}
