import { useEffect } from "react"

const FONT_URLS = [
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block",
]

// Fonts + smooth anchor scrolling for the public landing / login pages.
export default function useLandingFonts() {
  useEffect(() => {
    const added = FONT_URLS.filter((href) => !document.querySelector(`link[href="${href}"]`)).map((href) => {
      const link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = href
      document.head.appendChild(link)
      return link
    })
    // The app CSS makes <body> the scroll container, so smooth-scroll both.
    const els = [document.documentElement, document.body]
    const prev = els.map((el) => el.style.scrollBehavior)
    els.forEach((el) => { el.style.scrollBehavior = "smooth" })
    return () => {
      els.forEach((el, i) => { el.style.scrollBehavior = prev[i] })
      added.forEach((l) => l.remove())
    }
  }, [])
}
