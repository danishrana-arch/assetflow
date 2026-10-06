import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NavLink } from "react-router-dom"
import { LogOut } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { navGroups } from "../utils/navItems"
import logoFull from "../assets/logo1.png"

// macOS-Dock-style magnification. The icon under the cursor grows the most
// and nudges forward (to the right, away from the screen edge); neighbours
// within DOCK_RANGE px grow less, with a cosine falloff, and are pushed
// apart so the bigger icons never overlap. Transforms are written straight
// to the DOM inside a rAF — no React re-render per mouse move.
// Sized so a fully magnified icon still fits inside the 72px glass rail
// (44px × 1.4 ≈ 62px, centred) — the rail itself never moves.
const DOCK_MAX_SCALE = 1.4
const DOCK_RANGE = 110 // px from the cursor where icons still grow
const DOCK_FORWARD = 3 // px an icon nudges forward at full scale

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

// Items are the container's `[data-dock-item]` descendants in DOM order;
// `data-dock-fixed` ones (group dividers) never scale but still move with
// their neighbours. Positions come from offsetTop/offsetHeight — the
// untransformed layout — so magnifying never feeds back into itself. The
// container must be `relative` so it is the items' offsetParent.
function useDock(onHover) {
  const containerRef = useRef(null)
  const frame = useRef(0)
  const pointerY = useRef(null)

  function apply() {
    frame.current = 0
    const container = containerRef.current
    if (!container) return
    const items = Array.from(container.querySelectorAll("[data-dock-item]"))
    const y = pointerY.current

    if (y == null) {
      items.forEach((el) => {
        el.style.transform = ""
        el.style.zIndex = ""
        el.removeAttribute("data-dock-hovered")
      })
      onHover(null)
      return
    }

    const maxScale = prefersReducedMotion() ? 1 : DOCK_MAX_SCALE
    const metrics = items.map((el) => {
      const top = el.offsetTop
      const height = el.offsetHeight
      const fixed = el.hasAttribute("data-dock-fixed")
      const distance = Math.abs(y - (top + height / 2))
      const scale =
        fixed || distance >= DOCK_RANGE
          ? 1
          : 1 + (maxScale - 1) * Math.cos((distance / DOCK_RANGE) * (Math.PI / 2))
      return { el, top, height, scale, extra: (scale - 1) * height }
    })

    // Keep the point under the cursor anchored: everything above it moves up
    // by the growth above the cursor, everything below moves down.
    const anchor = metrics.reduce(
      (sum, m) => sum + m.extra * Math.min(Math.max((y - m.top) / m.height, 0), 1),
      0,
    )

    let before = 0
    let hovered = null
    let nearest = Infinity
    metrics.forEach((m) => {
      const shiftY = before + m.extra / 2 - anchor
      const shiftX = maxScale > 1 ? ((m.scale - 1) / (maxScale - 1)) * DOCK_FORWARD : 0
      before += m.extra
      // Whole-pixel moves and a 2-decimal scale: fractional offsets put the
      // icon strokes between pixels and make them look soft.
      const x = Math.round(shiftX)
      const yShift = Math.round(shiftY)
      m.el.style.transform =
        m.scale === 1 && x === 0 && yShift === 0 ? "" : `translate(${x}px, ${yShift}px) scale(${m.scale.toFixed(2)})`
      m.el.style.zIndex = m.scale > 1 ? String(Math.round(m.scale * 10)) : ""
      // Nearest icon, not "icon strictly under the cursor", so the label
      // doesn't blink off in the gaps between icons.
      const distance = Math.abs(y - (m.top + m.height / 2))
      if (!m.el.hasAttribute("data-dock-fixed") && distance < nearest) {
        nearest = distance
        hovered = { m, shiftX, shiftY }
      }
    })

    // Only the icon the label points at is drawn bold (see RailItem).
    items.forEach((el) => {
      if (el === hovered?.m.el) el.setAttribute("data-dock-hovered", "")
      else el.removeAttribute("data-dock-hovered")
    })

    if (hovered) {
      const rect = container.getBoundingClientRect()
      const { m, shiftX, shiftY } = hovered
      onHover({
        label: m.el.getAttribute("data-dock-label"),
        top: rect.top + m.top + m.height / 2 + shiftY,
        left: rect.left + m.el.offsetLeft + (m.el.offsetWidth * (1 + m.scale)) / 2 + shiftX + 10,
      })
    } else {
      onHover(null)
    }
  }

  function schedule() {
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return {
    ref: containerRef,
    onMouseMove(event) {
      const container = containerRef.current
      if (!container) return
      pointerY.current = event.clientY - container.getBoundingClientRect().top
      schedule()
    },
    onMouseLeave() {
      pointerY.current = null
      schedule()
    },
  }
}

// Bold + full colour for the one icon under the cursor; the rest stay normal.
const dockHoveredClass =
  "[&[data-dock-hovered]_svg]:[stroke-width:2.75]"

// No will-change: it makes the browser cache each icon as a bitmap at 1x,
// which is then stretched (blurry) when the dock magnifies it. Without it
// the icon is redrawn sharp at its magnified size.
const dockItemStyle = {
  transformOrigin: "center center",
  transition: "transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 200ms, color 200ms",
}

// The Dock's name bubble, beside the magnified icon. Portaled to <body>:
// the aside's backdrop-filter would otherwise make `fixed` resolve against
// the aside instead of the viewport.
function DockLabel({ tip, isDark }) {
  if (!tip?.label) return null
  return createPortal(
    <span
      className={`
        pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap
        rounded-md px-2.5 py-1 text-[12px] font-medium leading-none
        shadow-lg backdrop-blur-xl
        ${isDark ? "bg-[#1c1c1e]/90 text-white" : "bg-white/90 text-black"}
      `}
      style={{ top: tip.top, left: tip.left, fontFamily: "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif" }}
    >
      <span
        aria-hidden="true"
        className={`absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rotate-45 ${
          isDark ? "bg-[#1c1c1e]/90" : "bg-white/90"
        }`}
      />
      {tip.label}
    </span>,
    document.body,
  )
}

function RailItem({ to, label, icon: Icon, end, isDark }) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      data-dock-item=""
      data-dock-label={label}
      style={({ isActive }) =>
        isActive
          ? {
              ...dockItemStyle,
              backgroundColor: "var(--primary-container)",
              boxShadow: "inset 0 1px 1px rgba(255,255,255,0.18)",
            }
          : dockItemStyle
      }
      className={({ isActive }) =>
        `relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-colors duration-200 ${
          isActive
            ? "text-[var(--on-primary-container)]"
            : isDark
              ? `text-black/65 hover:bg-black/10 hover:text-black data-[dock-hovered]:text-black ${dockHoveredClass}`
              : `text-white/75 hover:bg-white/10 hover:text-white data-[dock-hovered]:text-white ${dockHoveredClass}`
        }`
      }
    >
      <Icon size={19} strokeWidth={2} />
    </NavLink>
  )
}

// The nav hides its native scrollbar for a cleaner rail, so this draws a thin
// line along the right edge instead: a faint track plus a thumb whose size and
// position mirror the scroll state. Only rendered when the list actually
// overflows, so short menus (e.g. the IT/employee branches) show nothing.
function useScrollIndicator(ref) {
  const [state, setState] = useState({ visible: false, top: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function update() {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight <= clientHeight + 1) {
        setState((s) => (s.visible ? { visible: false, top: 0, height: 0 } : s))
        return
      }
      const height = Math.max((clientHeight / scrollHeight) * 100, 12)
      const maxScroll = scrollHeight - clientHeight
      const top = (scrollTop / maxScroll) * (100 - height)
      setState({ visible: true, top, height })
    }

    update()
    el.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(el)
    Array.from(el.children).forEach((child) => observer.observe(child))
    return () => {
      el.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [ref])

  return state
}

export default function Sidebar() {
  const { logout, user } = useAuth()
  const { mode } = useTheme()

  const isDark = mode === "dark"
  const groups = navGroups(user)

  const navRef = useRef(null)
  const scrollIndicator = useScrollIndicator(navRef)

  const [tip, setTip] = useState(null)
  const navDock = useDock(setTip)
  const footerDock = useDock(setTip)

  // Scrolling moves the icons out from under a stale magnification.
  const resetNavDock = useRef(navDock.onMouseLeave)
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const reset = () => resetNavDock.current()
    el.addEventListener("scroll", reset, { passive: true })
    return () => el.removeEventListener("scroll", reset)
  }, [])

  return (
    <aside
      className={`
        fixed left-4 top-6 bottom-6 z-40 hidden w-[72px]
        flex-col items-stretch
        rounded-[26px]
        py-6
        lg:flex
        backdrop-blur-2xl
        backdrop-saturate-150
        ${
          isDark
            ? "bg-white/75 border border-white/80 text-black"
            : "bg-[#111313]/75 border border-white/10 text-white"
        }
      `}
      style={{
        backgroundImage: isDark
          ? "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 22%)"
          : "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 22%)",
        boxShadow: isDark
          ? "0 8px 32px rgba(0,0,0,0.10), inset 0 1px 1px rgba(255,255,255,0.45)"
          : "0 8px 32px rgba(0,0,0,0.18), inset 0 1px 1px rgba(255,255,255,0.12)",
      }}
    >
      <div className="mb-4 flex w-[70px] shrink-0 items-center justify-center">
        <img src={logoFull} alt="ManagementDock" className="h-9 w-9 rounded-xl object-contain drop-shadow-sm" />
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Drawn before the nav so magnified icons paint over it. */}
        {scrollIndicator.visible && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-1 right-[5px] top-1 w-[3px] rounded-full ${
              isDark ? "bg-black/10" : "bg-white/10"
            }`}
          >
            <div
              className={`absolute left-0 w-full rounded-full transition-[top] duration-100 ${
                isDark ? "bg-black/40" : "bg-white/45"
              }`}
              style={{ top: `${scrollIndicator.top}%`, height: `${scrollIndicator.height}%` }}
            />
          </div>
        )}

        <nav
          ref={navRef}
          className="
            relative flex min-h-0 flex-1 flex-col
            overflow-y-auto overflow-x-hidden
            py-3 pl-[11px]
            [scrollbar-width:none]
            [&::-webkit-scrollbar]:hidden
          "
        >
          <div
            ref={navDock.ref}
            onMouseMove={navDock.onMouseMove}
            onMouseLeave={navDock.onMouseLeave}
            className="relative flex w-12 flex-col items-center gap-1.5"
          >
            {groups.map((group, index) => (
              <div key={group.label} className="contents">
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    data-dock-item=""
                    data-dock-fixed=""
                    style={dockItemStyle}
                    className={`my-1 h-px w-6 shrink-0 ${isDark ? "bg-black/15" : "bg-white/15"}`}
                  />
                )}
                {group.items.map((item) => (
                  <RailItem
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    end={item.end}
                    isDark={isDark}
                  />
                ))}
              </div>
            ))}
          </div>
        </nav>

      </div>

      {/* Bottom controls — their own little dock, on the same axis as the nav. */}
      <div
        ref={footerDock.ref}
        onMouseMove={footerDock.onMouseMove}
        onMouseLeave={footerDock.onMouseLeave}
        className="relative ml-[11px] mt-2 flex w-12 shrink-0 flex-col items-center gap-1.5"
      >
        <button
          onClick={logout}
          aria-label="Logout"
          data-dock-item=""
          data-dock-label="Logout"
          style={dockItemStyle}
          className={`
            relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl
            transition-colors duration-200
            ${
              isDark
                ? `text-black/65 hover:bg-pink-100 hover:text-pink-600 ${dockHoveredClass}`
                : `text-white/75 hover:bg-chip-pink-bg hover:text-chip-pink-fg ${dockHoveredClass}`
            }
          `}
        >
          <LogOut size={16} />
        </button>
      </div>

      <DockLabel tip={tip} isDark={!isDark} />
    </aside>
  )
}
