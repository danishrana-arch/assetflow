import { useId } from "react"

export function TextField({ label, hint, error, className = "", id, ...props }) {
  const generatedId = useId()
  const fieldId = id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <input id={fieldId} className="field" {...props} />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {hint && !error && <p className="mt-1 text-xs text-muted-2">{hint}</p>}
    </div>
  )
}

export function SelectField({ label, children, className = "", id, ...props }) {
  const generatedId = useId()
  const fieldId = id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <select id={fieldId} className="field appearance-none pr-8" {...props}>
        {children}
      </select>
    </div>
  )
}

export function TextAreaField({ label, rows = 3, className = "", id, ...props }) {
  const generatedId = useId()
  const fieldId = id || generatedId
  return (
    <div className={className}>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </label>
      )}
      <textarea id={fieldId} rows={rows} className="field resize-none" {...props} />
    </div>
  )
}

export function FieldValue({ label, value, className = "" }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value || <span className="text-muted-2">—</span>}</p>
    </div>
  )
}
