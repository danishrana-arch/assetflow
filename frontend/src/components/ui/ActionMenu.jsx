import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import { MoreVertical } from "lucide-react"

/* The "⋮" menu used on rows, cards and drawer headers.

   items: [{ label, icon, onClick?, to?, danger?, show?, value? }]
   trigger   optional node used instead of the "⋮" (e.g. a status pill)
   selected  with item `value`s, marks the current choice
   `show: false` drops the item - pass the existing permission check there so
   the menu never offers something the API would refuse. With nothing left to
   show, the menu renders nothing at all.
   Portaled to <body> so a table's scroll container cannot clip it. */
export default function ActionMenu({ items, label = "More actions", className = "", trigger, selected }) {
  const visible = items.filter((i) => i.show !== false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onKey = (e) => e.key === "Escape" && close()
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
      window.removeEventListener("keydown", onKey)
    }
  }, [pos])

  // Flip above the button when there is no room below.
  useLayoutEffect(() => {
    if (!pos || !menuRef.current || !btnRef.current) return
    const h = menuRef.current.offsetHeight
    const r = btnRef.current.getBoundingClientRect()
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4
    if (top !== pos.top) setPos((p) => ({ ...p, top }))
  }, [pos])

  if (visible.length === 0) return null

  function toggle(e) {
    e.stopPropagation()
    if (pos) return setPos(null)
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 188, window.innerWidth - 196)) })
  }

  const row = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        className={trigger
          ? `rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`
          : `rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
      >
        {trigger || <MoreVertical size={16} />}
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setPos(null)} />
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[71] w-[188px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-card"
          >
            {visible.map((it, i) => {
              const Icon = it.icon
              const cls = `${row} ${it.danger ? "text-danger" : "text-ink"} ${selected != null && it.value === selected ? "font-semibold" : ""}`
              const inner = <>{Icon && <Icon size={14} />} {it.label}{selected != null && it.value === selected && <span className="ml-auto text-xs text-muted">current</span>}</>
              return it.to ? (
                <Link key={i} role="menuitem" to={it.to} className={cls} onClick={() => setPos(null)}>{inner}</Link>
              ) : (
                <button key={i} role="menuitem" type="button" className={cls} onClick={() => { setPos(null); it.onClick?.() }}>{inner}</button>
              )
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
