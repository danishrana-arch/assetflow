import { useEffect, useRef, useState } from "react"
import { SlidersHorizontal } from "lucide-react"

/* The "Filter" button + popover of dropdowns from the list toolbars.

   fields    [{ key, label, options: [{ value, label }], show? }]  (show:false hides one)
   values    { [key]: currentValue }   ("" = All)
   onChange  (key, value) => void
   onReset   () => void  - clears every field
   Shows how many fields are set on the button. Closes on Esc / outside click. */
export default function FilterMenu({ fields, values, onChange, onReset, label = "Filter" }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const visible = fields.filter((f) => f.show !== false)
  const count = visible.filter((f) => values[f.key]).length

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onDoc)
    window.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="pill-secondary flex items-center gap-1.5 px-3.5 py-2 text-sm"
      >
        <SlidersHorizontal size={14} /> {label}
        {count > 0 && <span className="rounded-full bg-ink px-1.5 text-[10px] font-semibold leading-4 text-canvas">{count}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={label} className="absolute right-0 z-30 mt-2 w-64 space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
          {visible.map((f) => (
            <label key={f.key} className="block text-xs font-medium text-muted">
              {f.label}
              <select
                className="field mt-1 w-full appearance-none pr-8"
                value={values[f.key] || ""}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                <option value="">All</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button type="button" onClick={onReset} disabled={count === 0} className="text-xs font-semibold text-muted hover:text-ink disabled:opacity-40">
              Reset
            </button>
            <button type="button" onClick={() => setOpen(false)} className="pill-accent px-4 py-1.5 text-xs">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
