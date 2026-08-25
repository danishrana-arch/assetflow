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

  const animatePull = () => {
    chainControls.start({
      y: 22,
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

    onToggle()
  }

  const handlePointerDown = (event) => {
    dragging.current = true
    startY.current = event.clientY

    event.currentTarget.setPointerCapture?.(
      event.pointerId
    )

    chainControls.start({
      y: 18,
      transition: {
        duration: 0.12,
      },
    })
  }

  const handlePointerUp = (event) => {
    if (!dragging.current) return

    dragging.current = false

    const distance =
      event.clientY - startY.current

    chainControls.start({
      y: 0,
      transition: {
        type: "spring",
        stiffness: 500,
        damping: 25,
      },
    })

    if (distance > 8) {
      onToggle()
    } else {
      onToggle()
    }
  }

  const handleKeyDown = (event) => {
    if (
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault()
      animatePull()
    }
  }

  return (
    <div className="relative mx-auto h-[470px] w-full max-w-[560px] sm:h-[510px]">

      {/* ======================================================
          LIGHT GLOW
          ====================================================== */}

      <motion.div
        className="pointer-events-none absolute left-1/2 top-[270px] h-[300px] w-[300px] -translate-x-1/2 rounded-full"
        animate={{
          opacity: isOn ? 0.65 : 0,
          scale: isOn ? 1 : 0.5,
        }}
        transition={{
          duration: 0.6,
          ease: "easeOut",
        }}
        style={{
          background:
            "radial-gradient(circle, rgba(255,205,95,.65) 0%, rgba(245,158,11,.25) 40%, transparent 72%)",
          filter: "blur(45px)",
        }}
      />


      {/* ======================================================
          CEILING CORD
          ====================================================== */}

      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2">

        <div className="mx-auto h-[82px] w-[3px] bg-gradient-to-r from-[#111] via-[#737b80] to-[#111] sm:h-[100px]" />

        {/* Ceiling canopy */}

        <div className="relative left-1/2 -mt-1 h-[30px] w-[72px] -translate-x-1/2 rounded-[10px] border border-white/10 bg-gradient-to-b from-[#454d52] to-[#111519] shadow-xl sm:h-[34px] sm:w-[82px]">

          <div className="absolute left-1/2 top-[7px] h-[4px] w-[35px] -translate-x-1/2 rounded-full bg-white/10" />

        </div>

      </div>


      {/* ======================================================
          LAMP BODY
          ====================================================== */}

      <div className="absolute left-1/2 top-[101px] z-20 -translate-x-1/2">

        {/* Upper metal stem */}

        <div className="mx-auto h-[38px] w-[32px] rounded-b-lg bg-gradient-to-r from-[#151a1d] via-[#727a7e] to-[#151a1d]" />


        {/* Metal collar */}

        <div className="relative mx-auto h-[38px] w-[78px] rounded-xl border border-white/10 bg-gradient-to-b from-[#697176] via-[#343b3f] to-[#111518] shadow-lg">

          <div className="absolute left-1/2 top-[7px] h-[6px] w-[42px] -translate-x-1/2 rounded-full bg-white/15" />

        </div>


        {/* ====================================================
            SHADE
            ==================================================== */}

        <div className="relative mx-auto mt-[-1px] h-[150px] w-[300px] sm:h-[175px] sm:w-[380px]">

          {/* Main shade */}

          <div
            className="absolute inset-0 overflow-hidden border border-white/10 bg-gradient-to-b from-[#3b444a] via-[#1c2327] to-[#080b0d] shadow-[0_30px_60px_rgba(0,0,0,.65)]"
            style={{
              clipPath:
                "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)",
            }}
          >

            {/* Shade reflection */}

            <div className="absolute left-[28%] top-[8%] h-[70%] w-[5%] rotate-[15deg] rounded-full bg-white/[0.04] blur-sm" />

            <div className="absolute right-[25%] top-[10%] h-[55%] w-[4%] rotate-[-15deg] rounded-full bg-white/[0.025] blur-sm" />

            {/* Soft top highlight */}

            <div className="absolute left-1/2 top-3 h-10 w-[50%] -translate-x-1/2 rounded-full bg-white/[0.025] blur-xl" />

          </div>


          {/* Top rim */}

          <div className="absolute left-1/2 top-[-4px] h-[10px] w-[165px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#858c90] to-[#22282c] shadow-md sm:w-[205px]" />


          {/* Bottom rim */}

          <div className="absolute bottom-[-6px] left-1/2 h-[18px] w-[310px] -translate-x-1/2 rounded-[50%] border border-white/15 bg-gradient-to-b from-[#858d91] via-[#343b3f] to-[#0a0d0f] shadow-[0_12px_25px_rgba(0,0,0,.6)] sm:w-[390px]" />


          {/* Inner reflector */}

          <motion.div
            className="absolute bottom-[-1px] left-1/2 h-[13px] w-[285px] -translate-x-1/2 rounded-[50%] sm:w-[365px]"
            animate={{
              backgroundColor: isOn
                ? "rgba(255,214,117,.95)"
                : "rgba(25,30,34,.95)",

              boxShadow: isOn
                ? "0 0 40px 12px rgba(245,158,11,.5)"
                : "none",
            }}
            transition={{
              duration: 0.4,
            }}
          />

        </div>


        {/* ====================================================
            SOCKET
            ==================================================== */}

        <div className="relative z-30 mx-auto -mt-[4px] h-[28px] w-[45px] rounded-b-md bg-gradient-to-b from-[#cbd0d3] via-[#747c81] to-[#343a3e] shadow-md">

          <div className="absolute left-1/2 top-[4px] h-[3px] w-[28px] -translate-x-1/2 rounded-full bg-white/30" />

        </div>


        {/* ====================================================
            BULB
            ==================================================== */}

        <div className="relative z-30 mx-auto mt-[-1px] h-[72px] w-[55px] sm:h-[82px] sm:w-[63px]">

          {/* Bulb glow */}

          <motion.div
            className="absolute left-1/2 top-1/2 h-[120px] w-[120px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            animate={{
              opacity: isOn ? 0.85 : 0,
              scale: isOn ? 1 : 0.5,
            }}
            transition={{
              duration: 0.5,
            }}
            style={{
              background:
                "radial-gradient(circle, rgba(255,225,140,.8), rgba(245,158,11,.25), transparent 70%)",
              filter: "blur(30px)",
            }}
          />


          {/* Glass */}

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
            transition={{
              duration: 0.45,
            }}
          >

            {/* Glass highlight */}

            <div className="absolute left-[14%] top-[12%] h-[30%] w-[16%] rotate-[18deg] rounded-full bg-white/40 blur-[2px]" />


            {/* Filament */}

            <motion.div
              className="absolute left-1/2 top-[18px] h-[40px] w-[18px] -translate-x-1/2"
              animate={{
                opacity: isOn ? 1 : 0.2,
              }}
            >

              <div className="absolute left-1/2 top-0 h-[36px] w-[2px] -translate-x-1/2 rounded-full bg-[#fff4b8]" />

              <div className="absolute left-1/2 top-[8px] h-[19px] w-[17px] -translate-x-1/2 rounded-full border border-[#fff4b8]" />

            </motion.div>

          </motion.div>

        </div>

      </div>


      {/* ======================================================
          PULL CHAIN
          ====================================================== */}

      <motion.div
        className="absolute left-[calc(50%+105px)] top-[247px] z-50 flex cursor-grab touch-none flex-col items-center active:cursor-grabbing sm:left-[calc(50%+135px)] sm:top-[275px]"
        animate={chainControls}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragging.current = false

          chainControls.start({
            y: 0,
            transition: {
              type: "spring",
              stiffness: 500,
              damping: 25,
            },
          })
        }}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-label={
          isOn
            ? "Pull the chain to turn the lamp off"
            : "Pull the chain to turn the lamp on"
        }
      >

        {/* Chain */}

        <div className="relative h-[125px] w-[3px] rounded-full bg-gradient-to-r from-[#76511d] via-[#f0cc75] to-[#76511d] sm:h-[145px]" />

        {/* Chain ball */}

        <motion.div
          className="h-[27px] w-[27px] rounded-full border border-[#f3cf7c] bg-gradient-to-br from-[#ffe39b] via-[#c18c32] to-[#68440f] shadow-lg"
          whileHover={{
            scale: 1.12,
          }}
          whileTap={{
            scale: 0.9,
          }}
        >

          <div className="ml-[5px] mt-[4px] h-[5px] w-[6px] rounded-full bg-white/40" />

        </motion.div>

      </motion.div>


      {/* ======================================================
          FLOOR LIGHT
          ====================================================== */}

      <motion.div
        className="absolute bottom-[25px] left-1/2 h-[28px] w-[220px] -translate-x-1/2 rounded-[50%] sm:w-[320px]"
        animate={{
          opacity: isOn ? 0.9 : 0.12,
          scale: isOn ? 1 : 0.7,

          boxShadow: isOn
            ? "0 0 55px 20px rgba(245,158,11,.3)"
            : "none",
        }}
        transition={{
          duration: 0.5,
        }}
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

      {/* Window header */}

      <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">

        <div className="flex items-center gap-1.5">

          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />

          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />

          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />

          <span className="ml-2 font-mono text-[9px] text-white/30 sm:text-[10px]">
            assetflow / welcome.jsx
          </span>

        </div>

        <span className="font-mono text-[9px] text-white/20">
          React
        </span>

      </div>


      {/* Code */}

      <div className="overflow-x-auto p-4 sm:p-5">

        <div className="min-w-[430px] font-mono text-[10px] leading-5 sm:text-[11px]">

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
     LOGGED IN
     ========================================================== */

  if (user) {
    return (
      <Navigate
        to="/dashboard"
        replace
      />
    )
  }


  /* ==========================================================
     PAGE
     ========================================================== */

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#080c0f] text-white">

      {/* ======================================================
          BACKGROUND
          ====================================================== */}

      <div className="pointer-events-none absolute inset-0 overflow-hidden">

        <div className="absolute left-1/2 top-[10%] h-[450px] w-[450px] -translate-x-1/2 rounded-full bg-slate-500/[0.06] blur-[120px] sm:h-[650px] sm:w-[650px]" />

        <div className="absolute bottom-0 left-1/2 h-[350px] w-[500px] -translate-x-1/2 rounded-full bg-amber-500/[0.035] blur-[120px]" />

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

          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] sm:h-10 sm:w-10">

            <img
              src={logoFull}
              alt="AssetFlow"
              className="h-6 w-6 object-contain sm:h-7 sm:w-7"
            />

          </div>


          <span className="text-sm font-semibold tracking-wide text-white/90 sm:text-base">
            AssetFlow
          </span>

        </Link>


        {/* Navigation */}

        <nav className="flex items-center gap-2 sm:gap-3">

          <Link
            to="/login"
            className="rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-2 text-[11px] font-semibold text-white/70 transition duration-200 hover:border-white/20 hover:bg-white/[0.08] hover:text-white sm:px-5 sm:text-sm"
          >
            Log in
          </Link>


          <Link
            to="/register"
            className="rounded-full bg-white px-3.5 py-2 text-[11px] font-semibold text-[#101417] shadow-lg shadow-black/20 transition duration-200 hover:-translate-y-0.5 hover:bg-white/90 sm:px-5 sm:text-sm"
          >
            Sign up
          </Link>

        </nav>

      </header>


      {/* ======================================================
          MAIN HERO
          ====================================================== */}

      <section className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8 lg:px-10">


        {/* ====================================================
            INTRO
            ==================================================== */}

        <div className="mx-auto max-w-3xl text-center">

          {/* Badge */}

          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px] text-white/45 backdrop-blur sm:text-[11px]">

            <Sparkles
              size={12}
              className="text-amber-300"
            />

            A smarter way to manage your workplace

          </div>


          {/* Heading */}

          <h1 className="text-[38px] font-semibold leading-[.98] tracking-[-0.05em] sm:text-5xl md:text-6xl lg:text-7xl">

            Welcome to{" "}

            <span className="text-amber-300">
              AssetFlow
            </span>

          </h1>


          {/* Description */}

          <p className="mx-auto mt-4 max-w-2xl px-2 text-xs leading-5 text-white/45 sm:text-sm sm:leading-6 md:text-base">

            Pull the string, light the workspace, and
            explore AssetFlow. Your inventory, people,
            attendance and payroll connected in one place.

          </p>

        </div>


        {/* ====================================================
            TWO COLUMN HERO
            ==================================================== */}

        <div className="mx-auto mt-8 grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[1fr_0.9fr] lg:gap-14 xl:gap-20">


          {/* ==================================================
              LEFT — LAMP
              ================================================== */}

          <div className="flex min-h-[500px] flex-col items-center justify-center">

            {/* Instruction */}

            <div className="mb-1 flex items-center gap-2 text-[10px] text-white/30 sm:text-xs">

              <MousePointer2 size={13} />

              Drag the string down or click it

            </div>


            {/* Lamp */}

            <Lamp
              isOn={isOn}
              onToggle={() =>
                setIsOn((value) => !value)
              }
            />

          </div>


          {/* ==================================================
              RIGHT — CONTENT
              ================================================== */}

          <div className="flex w-full flex-col justify-center">


            {/* Small heading */}

            <div className="mb-5">

              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-amber-300/70">

                Your workspace

              </div>


              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">

                Turn on your workspace.

              </h2>


              <p className="mt-2 max-w-md text-xs leading-5 text-white/40 sm:text-sm">

                Pull the lamp string to activate the
                experience, then create your workspace
                or sign in to continue.

              </p>

            </div>


            {/* ==================================================
                AUTH BUTTONS
                ================================================== */}

            <div className="flex w-full flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">

              {/* Sign up */}

              <Link
                to="/register"
                className="group flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-6 py-3.5 text-xs font-semibold text-[#101417] shadow-xl shadow-black/20 transition duration-200 hover:-translate-y-0.5 hover:bg-white/90 sm:text-sm"
              >

                Create your workspace

                <ArrowRight
                  size={15}
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />

              </Link>


              {/* Login */}

              <Link
                to="/login"
                className="flex flex-1 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] px-6 py-3.5 text-xs font-semibold text-white/65 transition duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white sm:text-sm"
              >

                I already have an account

              </Link>

            </div>


            {/* ==================================================
                STATUS
                ================================================== */}

            <motion.div
              className="mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3"
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

              {/* Icon */}

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


              {/* Text */}

              <div>

                <div
                  className={`text-[11px] font-medium ${
                    isOn
                      ? "text-amber-100/90"
                      : "text-white/60"
                  }`}
                >

                  {isOn
                    ? "Workspace activated"
                    : "Workspace is sleeping"}

                </div>


                <div className="mt-0.5 text-[9px] text-white/25 sm:text-[10px]">

                  {isOn
                    ? "The light is on welcome to AssetFlow."
                    : "Pull the string to turn the light on."}

                </div>

              </div>

            </motion.div>


            {/* ==================================================
                CODE PREVIEW
                ================================================== */}

            <div className="mt-5">

              <CodePreview
                isOn={isOn}
              />

            </div>


            {/* Trust text */}

            <div className="mt-4 flex items-center justify-center gap-2 text-[9px] text-white/20">

              <span className="h-1 w-1 rounded-full bg-emerald-400/50" />

              Secure workspace

              <span className="text-white/10">
                •
              </span>

              Simple setup

              <span className="text-white/10">
                •
              </span>

              Connected

            </div>

          </div>

        </div>


        {/* ====================================================
            FOOTER
            ==================================================== */}

        <p className="mt-10 text-center text-[9px] text-white/20 sm:text-[10px]">

          © 2026 AssetFlow. All rights reserved.

        </p>

      </section>

    </main>
  )
}