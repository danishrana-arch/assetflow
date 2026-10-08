import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronRight, X } from "lucide-react"
import Tabs from "./Tabs"

/* One contextual workspace for any record (employee, department, project...).

   open, onClose
   title, subtitle, leading   header text and an optional avatar/icon node
   breadcrumb                 [{ label, onClick? }] - where the user came from
   actions                    node rendered in the header (ActionMenu, buttons)
   tabs                       [{ key, label, count?, content }] - leave a tab out to hide it
   resetKey                   changes (e.g. the record id) -> back to the first tab

   Desktop/tablet: slides in from the right (max 2xl). Phones: full screen.
   Esc or a backdrop click closes it; page scroll is locked meanwhile. */
export default function DetailDrawer({ open, onClose, title, subtitle, leading, breadcrumb, actions, tabs = [], resetKey, children }) {
  const [tab, setTab] = useState(tabs[0]?.key)

  useEffect(() => { setTab(tabs[0]?.key) }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === "Escape" && onClose()
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  if (!open) return null
  const active = tabs.find((t) => t.key === tab) || tabs[0]

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Details"}
        className="absolute inset-y-0 right-0 flex w-full flex-col overflow-hidden border-l border-border bg-canvas shadow-card-lg sm:max-w-xl lg:max-w-2xl"
      >
        <header className="border-b border-border bg-surface px-4 pb-0 pt-4 sm:px-6">
          {breadcrumb?.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
              {breadcrumb.map((b, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {i > 0 && <ChevronRight size={12} />}
                  {b.onClick ? (
                    <button type="button" onClick={b.onClick} className="hover:text-ink hover:underline">{b.label}</button>
                  ) : (
                    <span className="text-ink">{b.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <div className="flex items-start gap-3 pb-3">
            {leading}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
              {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
            </div>
            {actions}
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink">
              <X size={18} />
            </button>
          </div>
          {tabs.length > 1 && <Tabs tabs={tabs} value={active?.key} onChange={setTab} className="border-b-0" />}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">{active ? active.content : children}</div>
      </aside>
    </div>,
    document.body,
  )
}
