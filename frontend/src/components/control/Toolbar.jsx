import { Search } from "lucide-react"

// Search box + filter controls row used above every table.
export default function Toolbar({ search, onSearch, placeholder = "Search…", children, right }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="field !pl-9" />
        </div>
      )}
      {children}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  )
}

export function FilterSelect({ value, onChange, label, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="field w-auto min-w-[130px] appearance-none pr-8">
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>
      ))}
    </select>
  )
}
