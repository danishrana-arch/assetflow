import { useState } from "react"
import Modal from "../billing/Modal"

/* Confirmation for anything destructive or billing-affecting.
   requireReason -> a reason must be typed; it is passed to onConfirm and
   recorded in the audit log. `error` shows a failed attempt inline. */
export default function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, requireReason, reasonLabel = "Reason", busy, error, onConfirm, onClose }) {
  const [reason, setReason] = useState("")
  const blocked = busy || (requireReason && reason.trim().length < 3)
  return (
    <Modal
      title={title}
      subtitle={message}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => onConfirm(reason.trim())}
            className={`${danger ? "bg-danger text-white" : "pill-accent"} rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {requireReason && (
        <div className="pb-2">
          <label htmlFor="confirm-reason" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">{reasonLabel}</label>
          <textarea id="confirm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="field resize-none" placeholder="Recorded in the audit log" autoFocus />
        </div>
      )}
      {error && <p role="alert" className="pb-2 text-sm text-danger">{error}</p>}
    </Modal>
  )
}
