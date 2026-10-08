import { useState } from "react"
import Modal from "../billing/Modal"

// Shows a one-time temporary password. It is never stored in readable form, so
// once this closes it can only be replaced (Reset password), not looked up.
export default function SecretDialog({ title, intro, label = "Temporary password", secret, onClose }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      /* clipboard blocked — the value is selectable */
    }
  }
  return (
    <Modal title={title} subtitle={intro} onClose={onClose} footer={<button type="button" onClick={onClose} className="pill-accent px-5 py-2.5 text-sm">I've saved it</button>}>
      <div className="pb-2">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink">{secret}</code>
          <button type="button" onClick={copy} className="pill-secondary shrink-0 px-4 py-2 text-sm">{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="mt-3 text-xs text-muted">Shown only once. Share it securely and ask them to change it after signing in.</p>
      </div>
    </Modal>
  )
}
