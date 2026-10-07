import { useEffect, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { motion, useAnimationControls } from "framer-motion"
import { ArrowRight, Lock } from "lucide-react"
import { useAuth } from "../context/AuthContext"
import logoFull from "../assets/logo1.png"
import officeImg from "../assets/welcome-office.png"
import dashboardImg from "../assets/welcome-dashboard.png"

/* Palette is written as hex values on purpose: the app's Tailwind theme
   redefines `slate`, so named slate/stone colours can't be relied on here. */
const BRASS = "#dcc66e"
const BRASS_LIGHT = "#f5df9a"
const IVORY = "#fbf9f5"
const MUTED = "#94a3b8"

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Space+Grotesk:wght@400;500&display=swap"

const mono = { fontFamily: '"Space Grotesk", ui-monospace, monospace' }
const serif = { fontFamily: '"Instrument Serif", Georgia, serif' }
const sans = { fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif' }

function useFonts() {
  useEffect(() => {
    if (document.getElementById("welcome-fonts")) return
    const link = document.createElement("link")
    link.id = "welcome-fonts"
    link.rel = "stylesheet"
    link.href = FONT_URL
    document.head.appendChild(link)
  }, [])
}

/* Viewer's own local time — no invented weather or city. */
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  return now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
}

export default function Welcome() {
  const { user, loading } = useAuth()
  const [lit, setLit] = useState(false)
  const chain = useAnimationControls()
  const clock = useClock()
  useFonts()

  const pull = () => {
    chain.start({
      y: [0, 22, -7, 4, -2, 0],
      rotate: [0, 0, 2, -1.5, 0.8, 0],
      transition: { duration: 0.9, ease: "easeOut" },
    })
    setLit((v) => !v)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090c12] px-5 text-white">
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-white/60">
          <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: BRASS }} />
          Preparing your workspace…
        </div>
      </div>
    )
  }

  if (user) return <Navigate to="/dashboard" replace />

  return (
    <main
      className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#090c12] text-[#cbd5e1] antialiased selection:bg-[#c5ab4f] selection:text-[#090c12]"
      style={sans}
    >
      {/* Header */}
      <header className="relative z-40 w-full border-b border-white/[0.06] bg-[#090c12]/70 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-10">
          <Link to="/" className="group flex items-center gap-3.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#141924] p-1.5 transition-colors group-hover:border-[#dcc66e]/50">
              <img src={logoFull} alt="ManagementDock" className="h-full w-full object-contain" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold tracking-tight" style={{ color: IVORY }}>
                Management<span className="font-normal" style={{ color: BRASS_LIGHT }}>Dock</span>
              </span>
              <span className="hidden text-[10px] uppercase tracking-widest text-[#64748b] sm:inline-block" style={mono}>
                The Workspace
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2.5 rounded-full border border-white/[0.08] bg-[#0e121a] px-3 py-1.5 text-[11px]">
            <span
              className="h-1.5 w-1.5 rounded-full transition-colors duration-500"
              style={{ background: lit ? BRASS : "#64748b", boxShadow: lit ? "0 0 8px rgba(245,223,154,.9)" : "none" }}
            />
            <span className="hidden text-[#94a3b8] sm:inline">{lit ? "Ambient 2700K" : "Ambient off"}</span>
            <span className="hidden text-[#475569] sm:inline">·</span>
            <span className="text-[#cbd5e1]" style={mono}>{clock}</span>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-center gap-10 px-6 py-8 lg:grid-cols-12 lg:gap-14 lg:px-10 lg:py-10">
        {/* RIGHT (desktop): narrative + login */}
        <div className="order-1 flex flex-col justify-center lg:order-2 lg:col-span-5 lg:pl-2">
          <span
            className="mb-3 inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors duration-500"
            style={{ ...mono, color: lit ? BRASS : "#64748b" }}
          >
            <span className="h-px w-2" style={{ background: "currentColor" }} />
            {lit ? "Welcome to your workspace" : "Welcome to"}
          </span>

          <h1 className="text-4xl font-light leading-[1.1] tracking-tight lg:text-[2.75rem]" style={{ color: IVORY }}>
            Management<span className="font-normal" style={{ color: BRASS_LIGHT }}>Dock</span>
          </h1>
          <p className="mt-2 text-xl italic sm:text-2xl" style={{ ...serif, color: "#e8e2d5" }}>
            {lit ? "“Everything your workplace needs. One place.”" : "“Your workplace is waiting.”"}
          </p>

          <p className="mb-8 mt-5 max-w-lg text-sm leading-relaxed text-[#94a3b8] sm:text-base">
            {lit
              ? "ManagementDock brings your people, daily attendance, projects and payroll together in one calm, clear workspace."
              : "Pull the brass cord to turn on the lamp and unlock your workspace."}
          </p>

          <div className="mb-9 max-w-md space-y-4">
            {!lit && (
              <button
                type="button"
                onClick={pull}
                aria-label="Pull the cord to unlock login"
                className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-white/10 bg-[#0e121a]/70 px-6 py-4 text-left opacity-70 transition hover:opacity-90"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-[#0e121a]/80 text-[#64748b]">
                  <Lock size={16} strokeWidth={1.8} />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold tracking-tight text-[#64748b]">Login to Your Workspace</span>
                  <span className="text-[11px] text-[#64748b]" style={mono}>Turn on the lamp to unlock</span>
                </div>
              </button>
            )}
            {lit && <Link
              to="/login"
              className="group relative flex w-full items-center justify-between overflow-hidden rounded-xl border border-[#dcc66e]/30 px-6 py-4 transition-all duration-200 hover:border-[#f5df9a]/55"
              style={{
                background: "linear-gradient(180deg,#1d2332 0%,#121722 100%)",
                boxShadow:
                  "0 12px 28px -6px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.1), 0 0 24px -4px rgba(220,198,110,.14)",
              }}
            >
              <div className="z-10 flex items-center gap-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#dcc66e]/30 bg-[#0e121a]/80 transition-all group-hover:scale-105 group-hover:border-[#f5df9a]" style={{ color: BRASS_LIGHT }}>
                  <Lock size={16} strokeWidth={1.8} />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-sm font-semibold tracking-tight text-[#f3efe6] group-hover:text-white">
                    Login to Your Workspace
                  </span>
                  <span className="text-[11px] text-[#94a3b8] transition-colors group-hover:text-[#f5df9a]" style={mono}>
                    Secure sign-in for your organization
                  </span>
                </div>
              </div>
              <ArrowRight size={18} className="z-10 transition-transform duration-200 group-hover:translate-x-1.5" style={{ color: BRASS_LIGHT }} />
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f5df9a]/40 to-transparent" />
            </Link>}

            <div className="flex items-center justify-between px-1 pt-1 text-xs">
              <span className="text-[#64748b]">New to ManagementDock?</span>
              <Link
                to="/register"
                className="font-medium underline decoration-[#c5ab4f]/50 underline-offset-4 transition-colors hover:text-white hover:decoration-[#f5df9a]"
                style={{ color: BRASS_LIGHT }}
              >
                Create a workspace →
              </Link>
            </div>
          </div>

          <div className="max-w-lg border-t border-white/[0.08] pt-6">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-[#64748b]" style={mono}>
              Everything in one dock
            </div>
            <div className="flex flex-wrap items-center gap-y-2 text-xs font-medium text-[#cbd5e1]">
              {["People", "Attendance", "Projects", "Payroll", "Assets"].map((t, i) => (
                <span key={t} className="flex items-center">
                  {i > 0 && <span className="mx-2.5 text-[#475569]">·</span>}
                  {t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* LEFT (desktop): lamp + office + dashboard */}
        <div className="relative order-2 flex flex-col items-center lg:order-1 lg:col-span-7">
          {/* Pendant lamp */}
          <div className="relative z-30 -mb-8 flex w-full flex-col items-center">
            <div className="h-10 w-[1.5px] bg-gradient-to-b from-[#78716c] to-[#c5ab4f]/80 sm:h-14" />
            <div className="relative flex flex-col items-center">
              <div className="h-1.5 w-3.5 rounded-t-sm bg-[#dcc66e]" />
              <div
                className="relative flex h-6 w-24 items-center justify-center rounded-t-full border-t border-[#dcc66e]/50 bg-gradient-to-r from-[#292524] via-[#44403c] to-[#1c1917] transition-shadow duration-700 sm:h-7 sm:w-28"
                style={{
                  boxShadow: lit
                    ? "0 0 50px 18px rgba(245,223,154,.38), 0 0 100px 35px rgba(220,198,110,.18)"
                    : "none",
                }}
              >
                <div
                  className="absolute -bottom-1 h-2 w-20 rounded-full border border-[#44403c] transition-all duration-700 sm:w-24"
                  style={{
                    background: lit ? "#fdf1c8" : "#181e28",
                    boxShadow: lit ? "0 2px 14px 4px rgba(245,223,154,.9)" : "none",
                  }}
                />
              </div>

              {/* Pull cord */}
              <motion.button
                type="button"
                onClick={pull}
                animate={chain}
                whileTap={{ y: 18 }}
                aria-label={lit ? "Pull the cord to dim the workspace" : "Pull the cord to light the workspace"}
                className="group absolute -bottom-28 right-3 z-40 flex origin-top cursor-pointer select-none flex-col items-center sm:-bottom-32 sm:right-5"
              >
                <div className="h-16 w-[1.5px] bg-gradient-to-b from-[#dcc66e]/90 via-[#c5ab4f] to-[#f5df9a] sm:h-20" />
                <div className="-mt-0.5 h-1.5 w-1.5 rounded-full bg-[#dcc66e]" />
                <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[#dcc66e]" />
                <div className="mt-1 flex h-5 w-2.5 items-center justify-center rounded-full border border-[#f5df9a]/50 bg-gradient-to-b from-[#f5df9a] via-[#dcc66e] to-[#a38a35] shadow-md transition-transform group-hover:scale-110 group-hover:shadow-[0_0_12px_rgba(245,223,154,.7)]">
                  <div className="h-3 w-1 rounded-full bg-[#f5df9a]/40" />
                </div>
                <div
                  className="pointer-events-none absolute left-6 top-8 flex items-center gap-1.5 whitespace-nowrap rounded-md border border-[#dcc66e]/40 bg-[#0e121a]/95 px-2.5 py-1 text-[10px] tracking-wider shadow-lg"
                  style={{ ...mono, color: BRASS_LIGHT }}
                >
                  {!lit && <span className="h-1 w-1 animate-ping rounded-full bg-[#f5df9a]" />}
                  {lit ? "Click cord to dim workspace" : "Pull cord to light workspace"}
                </div>
              </motion.button>
            </div>
          </div>

          {/* Desk frame */}
          <div className="relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0e121a]/90 p-2 shadow-2xl sm:p-2.5">
            <div
              className="pointer-events-none absolute inset-0 z-10 transition-opacity duration-[850ms]"
              style={{
                opacity: lit ? 1 : 0,
                background:
                  "radial-gradient(ellipse 65% 55% at 50% 12%, rgba(254,233,175,.32) 0%, rgba(220,185,105,.16) 42%, rgba(14,18,26,0) 80%)",
              }}
            />
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#090c12] sm:aspect-[16/11]">
              <img
                src={officeImg}
                alt="Executive desk in a bright office with floor-to-ceiling windows"
                className="h-full w-full object-cover object-center transition-[filter] duration-1000"
                style={{ filter: lit ? "brightness(.98) contrast(1.04)" : "brightness(.68) contrast(.95)" }}
              />
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#090c12]/70 via-[#090c12]/20 to-black/30 transition-opacity duration-700"
                style={{ opacity: lit ? 0.35 : 0.75 }}
              />
              <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded border border-white/10 bg-black/50 px-3 py-1 text-[10px] uppercase tracking-wider text-[#e8e2d5] backdrop-blur-md" style={mono}>
                <span className="h-1.5 w-1.5 rounded-full bg-[#dcc66e]" />
                Studio HQ • Executive Suite
              </div>
            </div>

            {/* Dashboard on the desk */}
            <div
              className="absolute -bottom-4 -right-2 z-20 w-[80%] overflow-hidden rounded-xl border border-white/20 bg-[#0e121a] transition-all duration-700 hover:-translate-y-1 sm:-bottom-6 sm:-right-4 sm:w-[72%]"
              style={{
                boxShadow: lit
                  ? "0 28px 65px -10px rgba(0,0,0,.85), 0 0 25px rgba(245,223,154,.12)"
                  : "0 20px 45px -10px rgba(0,0,0,.9)",
              }}
            >
              <div className="flex items-center justify-between border-b border-white/[0.08] bg-[#090c12]/95 px-3.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#475569]" />
                  <span className="h-2 w-2 rounded-full bg-[#475569]/70" />
                  <span className="h-2 w-2 rounded-full bg-[#475569]/70" />
                  <span className="ml-2 text-[10px] text-[#94a3b8]" style={mono}>managementdock · overview</span>
                </div>
                <span
                  className="rounded border px-2 py-0.5 text-[9px] uppercase tracking-wider transition-colors"
                  style={{
                    ...mono,
                    color: lit ? "#34d399" : "#94a3b8",
                    borderColor: lit ? "rgba(16,185,129,.25)" : "rgba(255,255,255,.1)",
                    background: lit ? "rgba(2,44,34,.6)" : "rgba(15,23,42,.8)",
                  }}
                >
                  {lit ? "Workspace Active" : "Standby"}
                </span>
              </div>
              <img
                src={dashboardImg}
                alt="ManagementDock dashboard preview"
                className="block h-auto w-full transition-[filter] duration-700"
                style={{ filter: lit ? "brightness(1) contrast(1.03)" : "brightness(.65) contrast(.95)" }}
              />
            </div>
          </div>

          {/* Module conduit */}
          <div className="mt-8 w-full px-2">
            <div className="relative flex items-center justify-between rounded-lg border-y border-white/[0.07] bg-[#0e121a]/40 px-4 py-2.5 backdrop-blur-sm">
              <div
                className="absolute left-6 right-6 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[#c5ab4f]/10 via-[#dcc66e]/40 to-[#c5ab4f]/10 transition-opacity duration-700"
                style={{ opacity: lit ? 1 : 0.3 }}
              />
              {["People", "Attendance", "Projects", "Payroll"].map((t) => (
                <div key={t} className="relative z-10 flex items-center gap-2 bg-[#0b0f17] px-2 text-[11px] text-[#cbd5e1]" style={mono}>
                  <span
                    className="h-1.5 w-1.5 rounded-full transition-all duration-700"
                    style={{ background: lit ? BRASS : "#64748b", boxShadow: lit ? "0 0 8px rgba(220,198,110,.8)" : "none" }}
                  />
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-20 w-full border-t border-white/[0.06] bg-[#090c12]/80 px-6 py-5 text-center text-xs text-[#64748b] lg:px-10">
        © {new Date().getFullYear()} ManagementDock. All rights reserved.
      </footer>
    </main>
  )
}
