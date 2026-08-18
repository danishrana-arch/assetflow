import { createContext, useContext, useEffect, useState } from "react"

const ThemeContext = createContext(null)

function applyAccent(hex) {
  if (!hex) return
  document.documentElement.style.setProperty("--accent", hex)
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
