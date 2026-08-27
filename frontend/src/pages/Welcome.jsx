import { useRef, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { motion, useAnimationControls } from "framer-motion"
import {
  ArrowRight,
  Lightbulb,
  MousePointer2,
  Sparkles,
} from "lucide-react"
import { useAuth } from "../context/AuthContext"
import logoFull from "../assets/logo1.png"


/* ============================================================
   LAMP
   ============================================================ */

function Lamp({ isOn, onToggle }) {
  const chainControls = useAnimationControls()
  const startY = useRef(0)
  const dragging = useRef(false)

  const animateChain = () => {
    chainControls.start({
      y: 20,
      transition: {
        duration: 0.12,
        ease: "easeOut",
      },
    })

    setTimeout(() => {
      chainControls.start({
        y: 0,
        transition: {
          type: "spring",
          stiffness: 500,
          damping: 25,
        },
      })
    }, 120)
  }

  const toggleLamp = () => {
    animateChain()
    onToggle()
  }

  const handlePointerDown = (event) => {
    dragging.current = true
    startY.current = event.clientY

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is not required for every browser.
    }

    chainControls.start({
      y: 15,
      transition: {
        duration: 0.1,
      },
    })
  }

  const handlePointerUp = (event) => {
    if (!dragging.current) return

    dragging.current = false

    const distance = event.clientY - startY.current

    chainControls.start({
      y: 0,
      transition: {
        type: "spring",
        stiffness: 500,
        damping: 25,
      },
    })

    /*
     * A small click or an actual pull both toggle the lamp.
     * This makes the interaction easier on phones and tablets.
     */
    if (distance > 8 || Math.abs(distance) <= 8) {
      onToggle()
    }
  }

  const handlePointerCancel = () => {
    dragging.current = false

    chainControls.start({
      y: 0,
      transition: {
        type: "spring",
        stiffness: 500,
        damping: 25,
      },
    })
  }

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault()
      toggleLamp()
    }
  }

  return (
    <div className="relative mx-auto h-[390px] w-full max-w-[430px] sm:h-[450px] sm:max-w-[500px] md:h-[480px] md:max-w-[530px] lg:h-[510px] lg:max-w-[560px]">

      {/* ======================================================
          LIGHT GLOW
          ====================================================== */}

      <motion.div
        className="pointer-events-none absolute left-1/2 top-[220px] h-[230px] w-[230px] -translate-x-1/2 rounded-full sm:top-[250px] sm:h-[280px] sm:w-[280px] md:top-[265px] md:h-[300px] md:w-[300px]"
        animate={{
          opacity: isOn ? 0.65 : 0,
          scale: isOn ? 1 : 0.5,
        }}
        transition={{ duration: 0.6 }}
        style={{
          background:
            "radial-gradient(circle, rgba(255,205,95,.65) 0%, rgba(245,158,11,.25) 40%, transparent 72%)",
          filter: "blur(40px)",
        }}
      />


      {/* Soft ceiling spill makes the lamp feel grounded in a real room. */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[72px] h-[90px] w-[260px] -translate-x-1/2 rounded-full blur-3xl"
        animate={{ opacity: isOn ? 0.34 : 0 }}
        transition={{ duration: 0.6 }}
        style={{ background: "radial-gradient(ellipse, rgba(255,214,120,.45), transparent 70%)" }}
      />

      {/* Directional cone of light under the shade. */}
      <motion.div
        className="pointer-events-none absolute left-1/2 top-[225px] z-10 h-[210px] w-[330px] -translate-x-1/2"
        animate={{ opacity: isOn ? 0.28 : 0, scaleY: isOn ? 1 : 0.65 }}
        transition={{ duration: 0.55 }}
        style={{
          clipPath: "polygon(42% 0%, 58% 0%, 100% 100%, 0% 100%)",
          background: "linear-gradient(180deg, rgba(255,220,140,.28), rgba(245,158,11,0))",
          filter: "blur(6px)",
        }}
      />

      {/* ======================================================
          CEILING
          ====================================================== */}

      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2">

        <div className="mx-auto h-[62px] w-[3px] bg-gradient-to-r from-[#111] via-[#737b80] to-[#111] sm:h-[78px] md:h-[90px]" />

        <div className="relative left-1/2 -mt-1 h-[25px] w-[58px] -translate-x-1/2 rounded-[9px] border border-white/10 bg-gradient-to-b from-[#454d52] to-[#111519] shadow-xl sm:h-[29px] sm:w-[70px] md:h-[32px] md:w-[80px]">

          <div className="absolute left-1/2 top-[6px] h-[4px] w-[28px] -translate-x-1/2 rounded-full bg-white/10 sm:w-[35px]" />

        </div>

      </div>


      {/* ======================================================
          LAMP BODY
          ====================================================== */}

      <div className="absolute left-1/2 top-[77px] z-20 -translate-x-1/2 sm:top-[94px] md:top-[102px]">

        {/* Upper stem */}

        <div className="mx-auto h-[30px] w-[26px] rounded-b-lg bg-gradient-to-r from-[#151a1d] via-[#727a7e] to-[#151a1d] sm:h-[35px] sm:w-[30px] md:h-[38px] md:w-[32px]" />


        {/* Metal collar */}

        <div className="relative mx-auto h-[30px] w-[62px] rounded-xl border border-white/10 bg-gradient-to-b from-[#697176] via-[#343b3f] to-[#111518] shadow-lg sm:h-[34px] sm:w-[70px] md:h-[38px] md:w-[78px]">

          <div className="absolute left-1/2 top-[6px] h-[5px] w-[34px] -translate-x-1/2 rounded-full bg-white/15 sm:w-[40px]" />

        </div>


        {/* ====================================================
            SHADE
            ==================================================== */}

        <div className="relative mx-auto mt-[-1px] h-[125px] w-[235px] sm:h-[150px] sm:w-[310px] md:h-[165px] md:w-[350px] lg:h-[175px] lg:w-[380px]">

          <div
            className="absolute inset-0 overflow-hidden border border-white/10 bg-gradient-to-b from-[#3b444a] via-[#1c2327] to-[#080b0d] shadow-[0_30px_60px_rgba(0,0,0,.65)]"
            style={{
              clipPath:
                "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)",
            }}
          >

            <div className="absolute left-[28%] top-[8%] h-[70%] w-[5%] rotate-[15deg] rounded-full bg-white/[0.04] blur-sm" />

            <div className="absolute right-[25%] top-[10%] h-[55%] w-[4%] rotate-[-15deg] rounded-full bg-white/[0.025] blur-sm" />

            <div className="absolute left-1/2 top-3 h-10 w-[50%] -translate-x-1/2 rounded-full bg-white/[0.025] blur-xl" />

          </div>


          <motion.div
            className="pointer-events-none absolute bottom-1 left-1/2 h-[92px] w-[76%] -translate-x-1/2 rounded-[50%] blur-2xl"
            animate={{ opacity: isOn ? 0.32 : 0 }}
            transition={{ duration: 0.45 }}
            style={{ background: "radial-gradient(ellipse, rgba(255,218,130,.65), transparent 72%)" }}
          />

          {/* Top rim */}

          <div className="absolute left-1/2 top-[-4px] h-[8px] w-[125px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#858c90] to-[#22282c] shadow-md sm:h-[9px] sm:w-[165px] md:w-[185px] lg:w-[205px]" />


          {/* Bottom rim */}

          <div className="absolute bottom-[-6px] left-1/2 h-[15px] w-[240px] -translate-x-1/2 rounded-[50%] border border-white/15 bg-gradient-to-b from-[#858d91] via-[#343b3f] to-[#0a0d0f] shadow-[0_12px_25px_rgba(0,0,0,.6)] sm:h-[17px] sm:w-[310px] md:w-[350px] lg:h-[18px] lg:w-[390px]" />


          {/* Inner reflector */}

          <motion.div
            className="absolute bottom-[-1px] left-1/2 h-[11px] w-[220px] -translate-x-1/2 rounded-[50%] sm:h-[12px] sm:w-[290px] md:w-[330px] lg:h-[13px] lg:w-[365px]"
            animate={{
              backgroundColor: isOn
                ? "rgba(255,214,117,.95)"
                : "rgba(25,30,34,.95)",

              boxShadow: isOn
                ? "0 0 40px 12px rgba(245,158,11,.5)"
                : "none",
            }}
            transition={{ duration: 0.4 }}
          />

        </div>


        {/* ====================================================
            SOCKET
            ==================================================== */}

        <div className="relative z-30 mx-auto -mt-[4px] h-[23px] w-[37px] rounded-b-md bg-gradient-to-b from-[#cbd0d3] via-[#747c81] to-[#343a3e] shadow-md sm:h-[26px] sm:w-[42px] md:h-[28px] md:w-[45px]">

          <div className="absolute left-1/2 top-[4px] h-[3px] w-[23px] -translate-x-1/2 rounded-full bg-white/30 sm:w-[28px]" />

        </div>


        {/* ====================================================
            BULB
            ==================================================== */}

        <div className="relative z-30 mx-auto mt-[-1px] h-[58px] w-[45px] sm:h-[68px] sm:w-[52px] md:h-[76px] md:w-[58px] lg:h-[82px] lg:w-[63px]">

          <motion.div
            className="absolute left-1/2 top-1/2 h-[90px] w-[90px] -translate-x-1/2 -translate-y-1/2 rounded-full sm:h-[110px] sm:w-[110px] md:h-[120px] md:w-[120px]"
            animate={{
              opacity: isOn ? 0.85 : 0,
              scale: isOn ? 1 : 0.5,
            }}
            transition={{ duration: 0.5 }}
            style={{
              background:
                "radial-gradient(circle, rgba(255,225,140,.8), rgba(245,158,11,.25), transparent 70%)",
              filter: "blur(25px)",
            }}
          />


          <motion.div
            className="relative h-full w-full overflow-hidden rounded-[50%_50%_45%_45%] border border-white/20"
            animate={{
              background: isOn
                ? "radial-gradient(circle at 50% 30%, #ffffff 0%, #fff7c7 28%, #ffd66e 60%, #e9a32d 100%)"
                : "radial-gradient(circle at 50% 30%, #8a9398 0%, #5d666b 55%, #30373b 100%)",

              boxShadow: isOn
                ? "0 0 30px 8px rgba(255,220,120,.8), 0 0 65px 15px rgba(245,158,11,.35)"
                : "0 3px 10px rgba(0,0,0,.45)",
            }}
            transition={{ duration: 0.45 }}
          >

            <div className="absolute left-[14%] top-[12%] h-[30%] w-[16%] rotate-[18deg] rounded-full bg-white/40 blur-[2px]" />


            <motion.div
              className="absolute left-1/2 top-[14px] h-[34px] w-[16px] -translate-x-1/2 sm:top-[18px] sm:h-[40px] sm:w-[18px]"
              animate={{
                opacity: isOn ? 1 : 0.2,
              }}
            >

              <div className="absolute left-1/2 top-0 h-[30px] w-[2px] -translate-x-1/2 rounded-full bg-[#fff4b8] sm:h-[36px]" />

              <div className="absolute left-1/2 top-[7px] h-[16px] w-[15px] -translate-x-1/2 rounded-full border border-[#fff4b8] sm:top-[8px] sm:h-[19px] sm:w-[17px]" />

            </motion.div>

          </motion.div>

        </div>

      </div>


      {/* ======================================================
          PULL CHAIN
          ====================================================== */}

      <motion.div
        className="absolute left-[calc(50%+70px)] top-[200px] z-50 flex cursor-grab touch-none flex-col items-center active:cursor-grabbing sm:left-[calc(50%+95px)] sm:top-[235px] md:left-[calc(50%+115px)] md:top-[250px] lg:left-[calc(50%+135px)] lg:top-[275px]"
        animate={chainControls}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={
          isOn
            ? "Pull the chain to turn the lamp off"
            : "Pull the chain to turn the lamp on"
        }
      >

        <div className="relative h-[100px] w-[3px] rounded-full bg-gradient-to-r from-[#76511d] via-[#f0cc75] to-[#76511d] sm:h-[120px] md:h-[135px] sm:w-[3px]" />

        <motion.div
          className="h-[23px] w-[23px] rounded-full border border-[#f3cf7c] bg-gradient-to-br from-[#ffe39b] via-[#c18c32] to-[#68440f] shadow-lg sm:h-[26px] sm:w-[26px] md:h-[27px] md:w-[27px]"
          whileHover={{ scale: 1.12 }}
          whileTap={{ scale: 0.9 }}
        >

          <div className="ml-[4px] mt-[4px] h-[4px] w-[5px] rounded-full bg-white/40" />

        </motion.div>

      </motion.div>


      {/* ======================================================
          FLOOR GLOW
          ====================================================== */}

      <motion.div
        className="absolute bottom-[10px] left-1/2 h-[22px] w-[180px] -translate-x-1/2 rounded-[50%] sm:bottom-[15px] sm:h-[25px] sm:w-[250px] md:w-[290px] lg:bottom-[25px] lg:h-[28px] lg:w-[320px]"
        animate={{
          opacity: isOn ? 0.9 : 0.12,
          scale: isOn ? 1 : 0.7,

          boxShadow: isOn
            ? "0 0 55px 20px rgba(245,158,11,.3)"
            : "none",
        }}
        transition={{ duration: 0.5 }}
        style={{
          background: isOn
            ? "rgba(255,199,80,.8)"
            : "rgba(130,140,145,.2)",
        }}
      />

    </div>
  )
}


/* ============================================================
   CODE PREVIEW
   ============================================================ */

function CodePreview({ isOn }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0d1117] text-left shadow-[0_20px_70px_rgba(0,0,0,.4)]">

      <div className="flex h-10 items-center justify-between border-b border-white/10 px-3 sm:h-11 sm:px-4">

        <div className="flex min-w-0 items-center gap-1.5">

          <span className="h-2 w-2 shrink-0 rounded-full bg-white/15 sm:h-2.5 sm:w-2.5" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-white/15 sm:h-2.5 sm:w-2.5" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-white/15 sm:h-2.5 sm:w-2.5" />

          <span className="ml-1 truncate font-mono text-[8px] text-white/30 sm:ml-2 sm:text-[10px]">
            assetflow / welcome.jsx
          </span>

        </div>

        <span className="ml-2 shrink-0 font-mono text-[8px] text-white/20 sm:text-[9px]">
          React
        </span>

      </div>


      <div className="overflow-x-auto p-3 sm:p-5">

        <div className="min-w-[360px] font-mono text-[9px] leading-5 sm:min-w-0 sm:text-[11px]">

          <div>
            <span className="text-violet-300">
              const
            </span>{" "}
            workspace ={" "}
            <span className="text-sky-300">
              AssetFlow
            </span>
            ()
          </div>

          <div>
            <span className="text-violet-300">
              const
            </span>{" "}
            light ={" "}
            <span
              className={
                isOn
                  ? "text-amber-200"
                  : "text-white/40"
              }
            >
              "{isOn ? "ON" : "OFF"}"
            </span>
          </div>

          <div className="text-white/25">
            // pull the string to toggle the workspace
          </div>

          <div>
            <span className="text-violet-300">
              return
            </span>{" "}
            workspace.
            <span className="text-sky-300">
              ready
            </span>
            (light)
          </div>

          <div className="text-white/25">
            // secure • simple • connected
          </div>

          <div
            className={
              isOn
                ? "mt-1 text-emerald-300"
                : "mt-1 text-white/30"
            }
          >
            {isOn
              ? "✓ Workspace ready."
              : "○ Waiting for the light..."}
          </div>

        </div>

      </div>

    </div>
  )
}


/* ============================================================
   WELCOME PAGE
   ============================================================ */

export default function Welcome() {
  const { user, loading } = useAuth()

  const [isOn, setIsOn] = useState(false)


  /* ==========================================================
     LOADING
     ========================================================== */

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080c0f] px-5 text-white">

        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-white/60">

          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />

          Preparing your workspace…

        </div>

      </div>
    )
  }


  /* ==========================================================
     LOGGED-IN USER
     ========================================================== */

  if (user) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    )
  }


  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080c0f] text-white">

      {/* ======================================================
          BACKGROUND
          ====================================================== */}

      <div className="pointer-events-none absolute inset-0 overflow-hidden">

        <div className="absolute left-1/2 top-[5%] h-[350px] w-[350px] -translate-x-1/2 rounded-full bg-slate-500/[0.06] blur-[100px] sm:h-[500px] sm:w-[500px] sm:blur-[120px] lg:h-[650px] lg:w-[650px]" />

        <div className="absolute bottom-0 left-1/2 h-[280px] w-[400px] -translate-x-1/2 rounded-full bg-amber-500/[0.035] blur-[100px] sm:h-[350px] sm:w-[500px] sm:blur-[120px]" />

      </div>


      {/* ======================================================
          HEADER
          ====================================================== */}

      <header className="relative z-50 mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-10">

        {/* Logo */}

        <Link
          to="/"
          className="flex min-w-0 items-center gap-2.5"
        >

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] p-1.5 sm:h-10 sm:w-10">

            <img
              src={logoFull}
              alt="AssetFlow"
              className="h-full w-full object-contain"
            />

          </div>

          <span className="truncate text-sm font-semibold tracking-wide text-white/90 sm:text-base">
            AssetFlow
          </span>

        </Link>


        {/* Header actions */}

        <nav className="flex shrink-0 items-center gap-1.5 sm:gap-3">

          {isOn ? (
            <Link
              to="/login"
              className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 text-[10px] font-semibold text-white/70 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white sm:px-5 sm:text-sm"
            >
              Log in
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-full border border-white/5 bg-white/[0.02] px-3 py-2 text-[10px] font-semibold text-white/20 sm:px-5 sm:text-sm"
            >
              Log in
            </button>
          )}


          {isOn ? (
            <Link
              to="/register"
              className="rounded-full bg-white px-3 py-2 text-[10px] font-semibold text-[#101417] shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-white/90 sm:px-5 sm:text-sm"
            >
              Sign up
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-full bg-white/10 px-3 py-2 text-[10px] font-semibold text-white/20 sm:px-5 sm:text-sm"
            >
              Sign up
            </button>
          )}

        </nav>

      </header>


      {/* ======================================================
          CONTENT
          ====================================================== */}

      <section className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-10 pt-5 sm:px-6 sm:pb-12 sm:pt-7 lg:px-10 lg:pt-8">

        {/* ====================================================
            INTRO
            ==================================================== */}

        <div className="mx-auto max-w-3xl text-center">

          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[9px] text-white/45 backdrop-blur sm:mb-4 sm:text-[11px]">

            <Sparkles
              size={11}
              className="shrink-0 text-amber-300"
            />

            <span>
              A smarter way to manage your workplace
            </span>

          </div>


          <h1 className="text-[36px] font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl md:text-6xl lg:text-7xl">

            Welcome to{" "}

            <span className="text-amber-300">
              AssetFlow
            </span>

          </h1>


          <p className="mx-auto mt-4 max-w-2xl px-2 text-[11px] leading-5 text-white/45 sm:text-sm sm:leading-6 md:text-base">

            Pull the string, light the workspace, and
            explore AssetFlow. Your inventory, people,
            attendance and payroll connected in one place.

          </p>

        </div>


        {/* ====================================================
            MAIN RESPONSIVE LAYOUT
            ==================================================== */}

        <div className="mx-auto mt-7 grid w-full max-w-6xl grid-cols-1 items-center gap-7 sm:mt-9 sm:gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-12 xl:gap-20">


          {/* ==================================================
              LEFT — LAMP
              ================================================== */}

          <div className="flex min-h-0 w-full items-center justify-center py-1 sm:py-3 lg:min-h-[500px]">

            <div className="flex w-full flex-col items-center">

              <div className="mb-0.5 flex items-center gap-2 text-[9px] text-white/30 sm:mb-1 sm:text-xs">

                <MousePointer2
                  size={12}
                />

                <span>
                  Pull the chain or tap it
                </span>

              </div>


              <Lamp
                isOn={isOn}
                onToggle={() =>
                  setIsOn((value) => !value)
                }
              />

            </div>

          </div>


          {/* ==================================================
              RIGHT — WORKSPACE ACCESS
              ================================================== */}

          <div className="flex w-full min-w-0 flex-col justify-center">

            <div className="mb-4 sm:mb-5">

              <div className="mb-2 text-[9px] font-medium uppercase tracking-[0.2em] text-amber-300/70 sm:text-[10px]">

                Your workspace

              </div>


              <motion.h2
                key={isOn ? "on" : "off"}
                initial={{
                  opacity: 0,
                  y: 8,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                className="text-2xl font-semibold tracking-tight text-white sm:text-3xl"
              >

                {isOn
                  ? "Welcome to your workspace."
                  : "Turn on your workspace."}

              </motion.h2>


              <motion.p
                key={`description-${isOn}`}
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: 1,
                }}
                className="mt-2 max-w-md text-[11px] leading-5 text-white/40 sm:text-sm"
              >

                {isOn
                  ? "The light is on. Create your account or sign in to continue."
                  : "Pull the lamp string to turn on the light and unlock your workspace."}

              </motion.p>

            </div>


            {/* ==================================================
                AUTH BUTTONS
                ================================================== */}

            <motion.div
              className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
              animate={{
                opacity: isOn ? 1 : 0.45,
              }}
              transition={{
                duration: 0.3,
              }}
            >

              {/* Register */}

              {isOn ? (
                <Link
                  to="/register"
                  className="group flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-xs font-semibold text-[#101417] shadow-xl shadow-black/20 transition duration-200 hover:-translate-y-0.5 hover:bg-white/90 sm:text-sm"
                >

                  Create your workspace

                  <ArrowRight
                    size={15}
                    className="transition-transform duration-200 group-hover:translate-x-1"
                  />

                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex min-h-[46px] cursor-not-allowed items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-xs font-semibold text-white/25 sm:text-sm"
                >

                  <Lightbulb
                    size={14}
                  />

                  Turn on the lamp first

                </button>
              )}


              {/* Login */}

              {isOn ? (
                <Link
                  to="/login"
                  className="flex min-h-[46px] items-center justify-center rounded-full border border-white/10 bg-white/[0.035] px-5 py-3 text-xs font-semibold text-white/65 transition duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:text-sm"
                >

                  I already have an account

                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex min-h-[46px] cursor-not-allowed items-center justify-center rounded-full border border-white/5 bg-white/[0.02] px-5 py-3 text-xs font-semibold text-white/20 sm:text-sm"
                >

                  Login locked

                </button>
              )}

            </motion.div>


            {/* ==================================================
                STATUS
                ================================================== */}

            <motion.div
              className="mt-3 flex items-center gap-3 rounded-2xl border px-3.5 py-3 sm:mt-4 sm:px-4"
              animate={{
                borderColor: isOn
                  ? "rgba(253,230,138,.22)"
                  : "rgba(255,255,255,.08)",

                backgroundColor: isOn
                  ? "rgba(245,158,11,.055)"
                  : "rgba(255,255,255,.025)",
              }}
              transition={{
                duration: 0.3,
              }}
            >

              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  isOn
                    ? "bg-amber-300/10"
                    : "bg-white/[0.04]"
                }`}
              >

                <Lightbulb
                  size={14}
                  className={
                    isOn
                      ? "text-amber-300"
                      : "text-white/30"
                  }
                />

              </div>


              <div className="min-w-0">

                <div
                  className={`text-[10px] font-medium sm:text-[11px] ${
                    isOn
                      ? "text-amber-100/90"
                      : "text-white/60"
                  }`}
                >

                  {isOn
                    ? "Workspace activated"
                    : "Workspace is sleeping"}

                </div>


                <div className="mt-0.5 text-[8px] leading-4 text-white/25 sm:text-[10px]">

                  {isOn
                    ? "The light is on login and registration are unlocked."
                    : "Pull the string to turn the light on."}

                </div>

              </div>

            </motion.div>


            {/* ==================================================
                CODE PREVIEW
                ================================================== */}

            <div className="mt-4 sm:mt-5">

              <CodePreview
                isOn={isOn}
              />

            </div>


            {/* Access state */}

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-center text-[8px] text-white/20 sm:mt-4 sm:text-[9px]">

              <span
                className={`h-1 w-1 rounded-full ${
                  isOn
                    ? "bg-emerald-400/70"
                    : "bg-white/20"
                }`}
              />

              <span>
                {isOn
                  ? "Workspace access unlocked"
                  : "Workspace access locked"}
              </span>

              <span className="text-white/10">
                •
              </span>

              <span>
                AssetFlow
              </span>

            </div>

          </div>

        </div>


        {/* ====================================================
            FOOTER
            ==================================================== */}

        <p className="mt-8 text-center text-[8px] text-white/20 sm:mt-10 sm:text-[10px]">

          © {new Date().getFullYear()} AssetFlow. All rights reserved.

        </p>

      </section>

    </main>
  )
}