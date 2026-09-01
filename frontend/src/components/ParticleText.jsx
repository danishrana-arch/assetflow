import { useEffect, useRef } from "react"

export default function ParticleText({
  text = "ASSETFLOW",
  height = 200,
  dotColor = "rgba(255,255,255,0.92)",
  accentColor = "#d39700e7",
  accentRatio = 0.22,
  background = "#050629",
  repelRadius = 150,
  repelStrength = 190,
  ease = 0.075,
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const particlesRef = useRef([])
  const mouseRef = useRef({ x: -9999, y: -9999, active: false })
  const rafRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return undefined

    const ctx = canvas.getContext("2d")
    if (!ctx) return undefined

    let width = 0
    let heightPx = height
    let dpr = Math.min(window.devicePixelRatio || 1, 2)
    let resizeObserver

    const buildParticles = (w, h) => {
      const offscreen = document.createElement("canvas")
      offscreen.width = Math.max(1, Math.floor(w))
      offscreen.height = Math.max(1, Math.floor(h))
      const offCtx = offscreen.getContext("2d")
      if (!offCtx) return []

      let fontSize = Math.min(h * 0.72, w * 0.22)
      fontSize = Math.max(32, Math.floor(fontSize))
      const fontFamily = "Arial Black, Arial, Helvetica, sans-serif"
      offCtx.font = `900 ${fontSize}px ${fontFamily}`
      let textWidth = offCtx.measureText(text).width

      while (textWidth > w * 0.88 && fontSize > 28) {
        fontSize -= 2
        offCtx.font = `900 ${fontSize}px ${fontFamily}`
        textWidth = offCtx.measureText(text).width
      }

      offCtx.clearRect(0, 0, w, h)
      offCtx.fillStyle = "#fff"
      offCtx.textAlign = "center"
      offCtx.textBaseline = "middle"
      offCtx.fillText(text, w / 2, h / 2 + fontSize * 0.035)

      const image = offCtx.getImageData(0, 0, offscreen.width, offscreen.height)
      const pixels = image.data
      const step = Math.max(3, Math.floor(fontSize / 24))
      const particles = []

      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const alpha = pixels[(y * offscreen.width + x) * 4 + 3]
          if (alpha > 150) {
            const accent = Math.random() < accentRatio
            particles.push({
              hx: x,
              hy: y,
              x: x + (Math.random() - 0.5) * 0.7,
              y: y + (Math.random() - 0.5) * 0.7,
              vx: 0,
              vy: 0,
              r: accent ? 1.35 + Math.random() * 0.45 : 0.8 + Math.random() * 0.45,
              alpha: 0.58 + Math.random() * 0.42,
              accent,
              phase: Math.random() * Math.PI * 2,
            })
          }
        }
      }
      return particles
    }

    const setup = () => {
      width = Math.max(1, container.clientWidth)
      heightPx = Math.max(120, Math.min(height, window.innerWidth < 640 ? 155 : height))
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(heightPx * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${heightPx}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particlesRef.current = buildParticles(width, heightPx)
    }

    const onPointerMove = (event) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      }
    }

    const onPointerLeave = () => {
      mouseRef.current.active = false
    }

    setup()
    canvas.addEventListener("pointermove", onPointerMove, { passive: true })
    canvas.addEventListener("pointerleave", onPointerLeave, { passive: true })

    resizeObserver = new ResizeObserver(setup)
    resizeObserver.observe(container)

    const tick = (time) => {
      ctx.clearRect(0, 0, width, heightPx)
      if (background !== "transparent") {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, heightPx)
      }

      const mouse = mouseRef.current
      const particles = particlesRef.current
      const t = time * 0.001

      for (const p of particles) {
        if (mouse.active) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.hypot(dx, dy)
          if (dist < repelRadius) {
            const safeDist = Math.max(dist, 0.001)
            const proximity = 1 - safeDist / repelRadius
            const force = proximity * proximity * repelStrength
            const nx = dx / safeDist
            const ny = dy / safeDist
            p.vx += nx * force * 0.018
            p.vy += ny * force * 0.018
            p.vx += -ny * force * 0.003
            p.vy += nx * force * 0.003
          }
        }

        p.vx += (p.hx - p.x) * ease
        p.vy += (p.hy - p.y) * ease
        if (mouse.active) {
          p.vx += Math.sin(t * 1.4 + p.phase) * 0.0015
          p.vy += Math.cos(t * 1.2 + p.phase) * 0.0015
        }
        p.vx *= 0.82
        p.vy *= 0.82
        p.x += p.vx
        p.y += p.vy

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = p.accent ? accentColor : dotColor
        ctx.fill()
      }

      ctx.globalAlpha = 1
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener("pointermove", onPointerMove)
      canvas.removeEventListener("pointerleave", onPointerLeave)
      resizeObserver?.disconnect()
    }
  }, [text, height, dotColor, accentColor, accentRatio, background, repelRadius, repelStrength, ease])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        aria-label={`${text} particle animation`}
        className="block h-full w-full touch-none"
      />
    </div>
  )
}
