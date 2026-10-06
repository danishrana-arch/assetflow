import { createContext, useContext, useEffect, useState } from "react"

const ThemeContext = createContext(null)

// Readable text on a solid accent fill: white on dark/saturated colours, a
// deep ink on light ones (WCAG relative luminance, same threshold browsers use
// for "contrast-color").
function onAccentFor(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return "#FFFFFF"
  const full = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.36 ? "#0E1A1A" : "#FFFFFF"
}

function applyAccent(hex) {
  if (!hex) return
  document.documentElement.style.setProperty("--accent", hex)
  document.documentElement.style.setProperty("--on-accent", onAccentFor(hex))
}

export function ThemeProvider({ children, initialAccent }) {
  const [mode, setMode] = useState(() => localStorage.getItem("assetflow_theme") || "light")

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark")
    localStorage.setItem("assetflow_theme", mode)
  }, [mode])

  useEffect(() => {
    if (initialAccent) applyAccent(initialAccent)
  }, [initialAccent])

  function toggleMode() {
    setMode((m) => (m === "light" ? "dark" : "light"))
  }

  return (
    <ThemeContext.Provider value={{ mode, toggleMode, applyAccent }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
