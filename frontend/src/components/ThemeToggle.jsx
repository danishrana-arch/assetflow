import { Moon, Sun } from "lucide-react"
import { useTheme } from "../context/ThemeContext"

// Apple-style liquid-glass switch: a frosted, slightly recessed track with a
// faint sun (left) and moon (right), and a glossy glass knob carrying the
// active icon — knob left = light mode, right = dark mode. Neutral black &
// white so it reads on light and dark backgrounds alike. Styles:
// .theme-switch in styles/index.css.
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
      <span aria-hidden="true" className="theme-switch-track-icon theme-switch-track-sun"><Sun size={13} /></span>
      <span aria-hidden="true" className="theme-switch-track-icon theme-switch-track-moon"><Moon size={13} /></span>
      <span aria-hidden="true" className="theme-switch-knob">
        {isDark ? <Moon size={15} /> : <Sun size={15} />}
      </span>
    </button>
  )
}
