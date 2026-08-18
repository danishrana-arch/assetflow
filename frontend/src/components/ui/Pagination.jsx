import { ChevronLeft, ChevronRight } from "lucide-react"

export default function Pagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted">
        Showing <span className="font-medium text-ink">{from}–{to}</span> of{" "}
        <span className="font-medium text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="pill-secondary flex h-8 w-8 items-center justify-center p-0 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="px-2 text-xs font-medium text-ink">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="pill-secondary flex h-8 w-8 items-center justify-center p-0 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
