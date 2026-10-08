import { useEffect } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

// Small centred dialog used across the Billing page.
export default function Modal({ title, subtitle, onClose, children, footer, size = "md", busy = false }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose, busy])

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className={`flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-surface shadow-2xl sm:rounded-3xl ${size === "lg" ? "sm:max-w-xl" : "sm:max-w-md"}`}>
        <div className="flex items-start justify-between gap-3 px-6 pb-3 pt-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink" style={{ letterSpacing: "-0.02em" }}>{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-6 pb-2">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
