import { MoreHorizontal } from "lucide-react"

export default function SectionHeader({ title, action, showMenu = false, className = "" }) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 ${className}`}>
      <h3 className="section-title">{title}</h3>
      <div className="flex items-center gap-2">
        {action}
        {showMenu && (
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            aria-label="Section menu"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
