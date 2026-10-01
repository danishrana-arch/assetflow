import { useLocation, useNavigate } from "react-router-dom"
import { ArrowLeft } from "lucide-react"
import { previousPage } from "../../utils/pageHistory"

// The round ← button. Returns to the page the user actually came from (with
// its filters); if there's none — the page was opened directly from a link,
// bookmark or a fresh tab — it goes to `fallback` (default: the dashboard).
// Hidden on the dashboard itself.
export default function BackButton({ fallback = "/", className = "" }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  if (pathname === "/" || pathname === "/dashboard") return null

  function goBack() {
    const prev = previousPage()
    navigate(prev && prev !== pathname ? prev : fallback)
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2 ${className}`}
      aria-label="Go back"
      title="Back"
    >
      <ArrowLeft size={18} />
    </button>
  )
}
