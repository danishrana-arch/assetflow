import { Moon, Sun } from "lucide-react"
import { useTheme } from "../context/ThemeContext"

export default function ThemeToggle() {
  const { mode, toggleMode } = useTheme()
  const isDark = mode === "dark"
  return (
    <div className="hidden flex-col items-center gap-2 rounded-full bg-surface p-1 shadow-card lg:flex">
      <button
        onClick={() => !isDark && toggleMode()}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          isDark ? "bg-ink text-white" : "text-muted hover:text-ink"
        }`}
        aria-label="Dark mode"
        title="Dark mode"
      >
        <Moon size={15} />
      </button>
      <button
        onClick={() => isDark && toggleMode()}
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          !isDark ? "bg-chip-yellow-bg text-chip-yellow-fg" : "text-muted hover:text-ink"
        }`}
        aria-label="Light mode"
        title="Light mode"
      >
        <Sun size={15} />
      </button>
    </div>
  )
}
