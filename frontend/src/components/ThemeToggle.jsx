import { Moon, Sun } from "lucide-react"
import { useTheme } from "../context/ThemeContext"

// iOS-style glass switch: frosted yellow track with the glass knob on the left
// (sun) in light mode, frosted periwinkle track with the knob on the right
// (moon) in dark mode. Styles: .theme-switch in styles/index.css.
export default function ThemeToggle({ className = "" }) {
  const { mode, toggleMode } = useTheme()
  const isDark = mode === "dark"
  const label = isDark ? "Switch to light mode" : "Switch to dark mode"

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      data-on={isDark}
      onClick={toggleMode}
      className={`theme-switch ${className}`}
    >
      <span aria-hidden="true" className="theme-switch-knob">
        {isDark ? <Moon size={14} strokeWidth={2.2} /> : <Sun size={14} strokeWidth={2.2} />}
      </span>
    </button>
  )
}
