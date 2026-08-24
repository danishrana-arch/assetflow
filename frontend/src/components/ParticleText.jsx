import { useEffect, useRef } from "react"

export default function ParticleText({
  text = "AssetFlow",
  height = 200,
  dotColor = "rgb(255, 255, 255)",
  accentColor = "#F9BD22", 
  accentRatio = 0.06, 
  background = "#050629e7",
  repelRadius = 90,
  repelStrength = 55,
  ease = 0.12,
  
}) {
  const canvasRef = useRef(null)
  const containerRef = useRef(null)
  const mouseRef = useRef({ x: -9999, y: -9999, active: false })
  const particlesRef = useRef([])
  const rafRef = useRef(null)

   
  function buildParticles(width, heightPx) {
    const off = document.createElement("canvas")
    off.width = width
    off.height = heightPx
    const octx = off.getContext("2d")

    let fontSize = Math.floor(heightPx * 0.5)
    octx.font = `800 ${fontSize}px 'Inter', sans-serif`
    let textWidth = octx.measureText(text).width
     while (textWidth > width * 0.92 && fontSize > 10) {
      fontSize -= 2
      octx.font = `800 ${fontSize}px 'Inter', sans-serif`
      textWidth = octx.measureText(text).width
    }

    octx.fillStyle = "#fff"
    octx.textBaseline = "middle"
    octx.fillText(text, (width - textWidth) / 2, heightPx / 2)

    const { data } = octx.getImageData(0, 0, width, heightPx)
    const step = Math.max(3, Math.floor(fontSize / 22)) // sample density scales with text size

    const particles = []
    for (let y = 0; y < heightPx; y += step) {
      for (let x = 0; x < width; x += step) {
        const alpha = data[(y * width + x) * 4 + 3]
        if (alpha > 128) {
          particles.push({
            hx: x,
            hy: y,
            x: x,
            y: y,
            isAccent: Math.random() < accentRatio,
            r: Math.random() < accentRatio ? 1.6 : 1.1,
          })
        }
      }
    }
    return particles
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = container.offsetWidth

    function setup() {
      width = container.offsetWidth
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const ctx = canvas.getContext("2d")
      ctx.scale(dpr, dpr)
      particlesRef.current = buildParticles(width, height)
    }
    setup()

    const ctx = canvas.getContext("2d")

    function onMouseMove(e) {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true }
    }
    function onMouseLeave() {
      mouseRef.current.active = false
    }

    canvas.addEventListener("mousemove", onMouseMove)
    canvas.addEventListener("mouseleave", onMouseLeave)

    function tick() {
      ctx.clearRect(0, 0, width, height)
      if (background !== "transparent") {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, height)
      }

      const mouse = mouseRef.current
      for (const p of particlesRef.current) {
        if (mouse.active) {
          const dx = p.x - mouse.x
          const dy = p.y - mouse.y
          const dist = Math.hypot(dx, dy)
          if (dist < repelRadius && dist > 0.01) {
            const force = ((repelRadius - dist) / repelRadius) * repelStrength
            p.x += (dx / dist) * force * 0.15
            p.y += (dy / dist) * force * 0.15
          }
        }
         p.x += (p.hx - p.x) * ease
        p.y += (p.hy - p.y) * ease

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.isAccent ? accentColor : dotColor
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    function onResize() {
      setup()
    }
    window.addEventListener("resize", onResize)

    return () => {
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener("mousemove", onMouseMove)
      canvas.removeEventListener("mouseleave", onMouseLeave)
      window.removeEventListener("resize", onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, height, dotColor, accentColor, accentRatio, background, repelRadius, repelStrength, ease])

  return (
    <div ref={containerRef} style={{ width: "100%", height }}>
      <canvas ref={canvasRef} style={{ display: "block", cursor: "default" }} />
    </div>
  )
}
