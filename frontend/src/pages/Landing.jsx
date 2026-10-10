import { useEffect, useState } from "react"
import { Link, Navigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useLandingFonts from "../hooks/useLandingFonts"
import logoFull from "../assets/logo1.png"
import { useQuery } from "@tanstack/react-query"
import api from "../api/client"
import { formatMoney, limitLabel } from "../utils/billing"

/* Public landing page ("Luminous Spectrum" design). All colours / spacing /
   type tokens used below (primary, space-md, text-headline-sm …) are defined
   in tailwind.config.js. Light-only by design. */

const BTN =
  "inline-flex items-center justify-center gap-space-xs rounded-xl font-label-lg text-label-lg font-bold text-on-primary text-center bg-gradient-to-r from-primary via-primary-container to-secondary shadow-[0_8px_24px_-2px_rgba(121,87,255,0.35)] hover:shadow-[0_12px_28px_-2px_rgba(121,87,255,0.48)] hover:brightness-105 active:scale-95 transition-all duration-200"
const CONTAINER = "w-full max-w-[1680px] mx-auto px-margin-mobile md:px-margin-tablet xl:px-margin"

function Icon({ name, className = "" }) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined select-none ${className}`}>
      {name}
    </span>
  )
}

/* ───────────────────────── data ───────────────────────── */

const NAV = [
  { label: "Solutions", href: "#solutions" },
  { label: "Capabilities", href: "#interactive-preview" },
  { label: "Analytics", href: "#analytics" },
  { label: "Security", href: "#security" },
  { label: "Pricing", href: "#pricing" },
]

const TRUST = [
  { icon: "verified_user", text: "SOC2 Type II Certified" },
  { icon: "lock", text: "256-Bit Hardware Encryption" },
  { icon: "visibility_off", text: "Zero-Knowledge Privacy" },
  { icon: "cloud_sync", text: "Offline Event Mesh" },
]

const BRANDS = [
  { icon: "diamond", color: "text-primary", name: "AETHEL CORP" },
  { icon: "radar", color: "text-secondary", name: "ORBITAL INFRA" },
  { icon: "hub", color: "text-tertiary", name: "SYNAPSE LOGISTICS" },
  { icon: "shield_with_heart", color: "text-primary-container", name: "NOVA FINTECH" },
  { icon: "deployed_code", color: "text-secondary-container", name: "HYPERION SYSTEMS" },
]

const FEATURES = [
  {
    bar: "from-primary to-primary-container",
    iconBg: "from-primary to-primary-container",
    icon: "groups",
    tag: "Violet • Indigo Core",
    tagCls: "bg-primary-fixed text-on-primary-fixed",
    title: "Workforce Management",
    body: "Dynamic org-chart topologies, instant talent allocation, automated shift rotations, and real-time workload balancing across cross-border divisions.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex items-center justify-between gap-space-sm text-on-surface">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-full bg-primary-fixed flex items-center justify-center font-bold text-primary text-label-md">SJ</span>
          <div className="min-w-0">
            <span className="font-title-md text-title-md font-bold block leading-none truncate">Sarah Jenkins</span>
            <span className="font-label-caps text-label-caps text-on-surface-variant">Lead Systems Architect</span>
          </div>
        </div>
        <span className="shrink-0 px-space-xs py-space-2xs rounded bg-surface-container-highest text-primary font-label-caps text-label-caps font-bold">Allocated 100%</span>
      </div>
    ),
  },
  {
    bar: "from-tertiary-fixed-dim to-secondary",
    iconBg: "from-tertiary to-secondary-container",
    icon: "pin_drop",
    tag: "Cyan • Blue Radar",
    tagCls: "bg-tertiary-fixed text-on-tertiary-fixed",
    title: "Attendance & Geofencing",
    body: "Zero background tracking. Polygon perimeter entry logs with hardware cryptographic tokens, biometric confirmation, and local fallback buffers.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex flex-wrap items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-xs">
          <Icon name="satellite_alt" className="text-tertiary text-[20px]" />
          <span className="font-title-md text-title-md font-bold">Polygon: Dubai Hub HQ</span>
        </div>
        <span className="flex items-center gap-space-2xs text-tertiary font-label-md text-label-md font-bold">
          <span className="w-2 h-2 rounded-full bg-tertiary animate-ping" /> 10m Accuracy
        </span>
      </div>
    ),
  },
  {
    bar: "from-secondary to-primary-container",
    iconBg: "from-secondary to-primary",
    icon: "schema",
    tag: "Blue • Purple Mesh",
    tagCls: "bg-secondary-fixed text-on-secondary-fixed",
    title: "Projects & Workflows",
    body: "Hierarchical milestone tracking, autonomous blocker detection, SLA triggers, and dynamic dependency graphs spanning complex corporate portfolios.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex flex-col gap-space-xs">
        <div className="flex justify-between items-center gap-space-sm font-label-caps text-label-caps font-bold">
          <span>Phase IV: Infrastructure Migration</span>
          <span className="text-secondary">84%</span>
        </div>
        <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
          <div className="bg-gradient-to-r from-secondary to-primary h-full w-[84%]" />
        </div>
      </div>
    ),
  },
  {
    bar: "from-tertiary-fixed-dim to-tertiary",
    iconBg: "from-tertiary-container to-tertiary",
    icon: "account_balance_wallet",
    tag: "Emerald • Teal Engine",
    tagCls: "bg-tertiary-fixed text-on-tertiary-fixed",
    title: "Finance & Payroll",
    body: "Single-click multi-currency disbursements, tax compliance calculations across 40+ jurisdictions, and algorithmic expense reconciliation.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex items-center justify-between gap-space-sm">
        <div>
          <span className="font-label-caps text-label-caps text-on-surface-variant block">Scheduled Run</span>
          <span className="font-title-md text-title-md font-bold text-on-surface">Oct Cycle Reconciled</span>
        </div>
        <div className="flex shrink-0 items-center gap-space-2xs px-space-xs py-space-2xs rounded bg-surface-container-highest text-tertiary font-bold text-label-md">
          <Icon name="check_circle" className="text-[16px]" /> Approved
        </div>
      </div>
    ),
  },
  {
    bar: "from-primary to-tertiary-fixed-dim",
    iconBg: "from-primary via-secondary to-tertiary",
    icon: "devices",
    tag: "Indigo • Cyan Custody",
    tagCls: "bg-secondary-fixed text-on-secondary-fixed",
    title: "Inventory & Assets",
    body: "Complete hardware lifecycle custody, RFID scanning, remote MDM status checks, warranty alerts, and zero-trust handover verification.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex flex-wrap items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-xs">
          <Icon name="qr_code_scanner" className="text-primary text-[20px]" />
          <span className="font-title-md text-title-md font-bold">14,290 Units Active</span>
        </div>
        <span className="text-tertiary font-label-caps text-label-caps font-bold uppercase">Zero Unaccounted</span>
      </div>
    ),
  },
  {
    bar: "from-primary-container via-primary to-secondary",
    iconBg: "from-primary-container to-secondary",
    icon: "domain_add",
    tag: "Magenta • Violet Federation",
    tagCls: "bg-primary-fixed text-on-primary-fixed",
    title: "Multi-Company Management",
    body: "Seamlessly switch subsidiaries with segregated data isolation, shared corporate directories, and unified board-level aggregated reporting.",
    demo: (
      <div className="p-space-sm bg-surface-container-low rounded-xl flex items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-xs">
          <Icon name="corporate_fare" className="text-secondary text-[20px]" />
          <span className="font-title-md text-title-md font-bold">12 Legal Entities</span>
        </div>
        <span className="shrink-0 px-space-xs py-space-2xs rounded bg-surface-container-highest text-secondary font-label-caps text-label-caps font-bold">Unified Audit</span>
      </div>
    ),
  },
]

const TABS = [
  {
    label: "Workforce Telemetry",
    status: "Synchronous Mesh Active",
    eyebrow: "Zero-Latency Operations",
    title: "Real-Time Organizational Cohesion",
    body: "ManagementDock continuously resolves organizational state transitions across all entities without batch delays. When an engineer clocks in via geofence, their project availability, equipment authorization, and daily payroll accrual synchronize concurrently.",
    stats: [["Global Uptime", "99.999%", "text-tertiary-fixed"], ["Active Handshakes", "48,290/s", "text-on-primary"], ["State Consensus", "Instantaneous", "text-primary-fixed"]],
    points: [
      { icon: "verified", color: "text-tertiary-fixed", title: "Zero Re-Verification Bottlenecks", sub: "Hardware-enforced zero-trust validation", value: "100%" },
      { icon: "sync_alt", color: "text-primary-fixed", title: "Multi-Jurisdiction Automated Tax", sub: "Localized statutory compliance", value: "42 Regions" },
    ],
  },
  {
    label: "Geofence Perimeter",
    status: "Perimeters Monitored",
    eyebrow: "Precision Attendance",
    title: "Check-Ins Verified at the Perimeter",
    body: "Coordinates are validated only at the moment an employee checks in, against pre-approved polygon perimeters. Outside those boundaries nothing is tracked, and offline check-ins reconcile automatically on reconnect.",
    stats: [["Verified On-Site", "98.4%", "text-tertiary-fixed"], ["Sync Drift", "±0.4s", "text-on-primary"], ["Exceptions", "0", "text-primary-fixed"]],
    points: [
      { icon: "pin_drop", color: "text-tertiary-fixed", title: "Polygon Operational Perimeters", sub: "Unlimited sites per entity", value: "10m" },
      { icon: "offline_pin", color: "text-primary-fixed", title: "Offline Fallback Sync", sub: "Cryptographic timestamp receipts", value: "Auto" },
    ],
  },
  {
    label: "Custody Ledger",
    status: "Ledger In Sync",
    eyebrow: "Asset Custody",
    title: "Every Device, Accounted For",
    body: "From procurement to retirement, every handover is recorded with a verifiable custody trail, so you always know which device is with whom, in what condition, and under which warranty.",
    stats: [["Units Active", "14,290", "text-tertiary-fixed"], ["Unaccounted", "Zero", "text-on-primary"], ["Handover Audit", "Immutable", "text-primary-fixed"]],
    points: [
      { icon: "qr_code_scanner", color: "text-tertiary-fixed", title: "RFID & Barcode Scanning", sub: "Instant check-out and check-in", value: "Live" },
      { icon: "event_available", color: "text-primary-fixed", title: "Warranty & Lifecycle Alerts", sub: "Renewals flagged before expiry", value: "Proactive" },
    ],
  },
  {
    label: "Automated Payroll",
    status: "Payroll Reconciled",
    eyebrow: "Finance Engine",
    title: "Payroll That Runs Itself",
    body: "Attendance, approved leave, expense claims and salary revisions flow straight into each cycle, so payroll is calculated from verified data and reconciled before anyone has to ask.",
    stats: [["Cycle Status", "Reconciled", "text-tertiary-fixed"], ["Batch Value", "$1.84M", "text-on-primary"], ["Approval", "One Click", "text-primary-fixed"]],
    points: [
      { icon: "payments", color: "text-tertiary-fixed", title: "Multi-Currency Disbursements", sub: "Single-click global batch runs", value: "Global" },
      { icon: "receipt_long", color: "text-primary-fixed", title: "Expense Reconciliation", sub: "Claims matched to cycles", value: "Auto" },
    ],
  },
]

const FOOTER_COLS = [
  { title: "Architecture", links: ["Control Systems", "Analytical Telemetry", "Multi-Cloud Mesh", "Identity Federation", "API Synthetics"] },
  { title: "Governance", links: ["SOC2 Compliance", "Data Residency", "Zero Trust Mesh", "Air-Gapped Ops", "Privacy Shield"] },
  { title: "Enterprise", links: ["Executive Advisory", "Case Studies", "Partner Ecosystem", "Status Telemetry", "Support Desk"] },
]

/* ───────────────────────── page ───────────────────────── */

export default function Landing() {
  const { user, loading } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [tab, setTab] = useState(0)
  useLandingFonts()
  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ["public", "plans"],
    queryFn: () => api.get("/public/plans").then((r) => r.data),
    staleTime: 60_000,
  })
  const plans = plansData || []

  useEffect(() => {
    if (!menuOpen) return
    const onResize = () => window.innerWidth >= 1280 && setMenuOpen(false)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [menuOpen])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-margin-mobile font-body-md">
        <div className="flex items-center gap-space-sm rounded-full bg-surface-container-lowest px-space-lg py-space-sm text-body-md text-on-surface-variant shadow-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          Preparing your workspace…
        </div>
      </div>
    )
  }

  if (user) return <Navigate to="/dashboard" replace />

  const active = TABS[tab]

  const navLink = "px-space-md py-space-sm rounded-lg font-label-lg text-label-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"

  return (
    <div className="min-h-screen bg-background font-body-md text-body-md text-on-surface antialiased selection:bg-primary-fixed selection:text-on-primary-fixed overflow-x-clip">
      {/* ── Header ── */}
      <header className="fixed top-0 left-0 right-0 z-50 overflow-hidden border-b border-white/70 bg-gradient-to-b from-white/80 via-white/55 to-white/40 backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/70 to-transparent" />
        <div className={`relative h-20 ${CONTAINER} flex items-center justify-between gap-gutter-tablet`}>
          <a href="#top" className="flex items-center gap-space-sm min-w-0">
            <img src={logoFull} alt="ManagementDock" className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-xl object-contain" />
            <div className="flex flex-col min-w-0">
              <span className="font-headline-sm text-headline-sm tracking-tight text-on-surface font-extrabold leading-tight whitespace-nowrap max-[419px]:!text-[15px]">
                Management<span className="text-primary">Dock</span>
              </span>
              <span className="hidden sm:block font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Enterprise Operations</span>
            </div>
          </a>

          <nav aria-label="Primary" className="hidden xl:flex items-center gap-space-xs p-space-2xs bg-surface-container-low/60 rounded-xl">
            {NAV.map((n) => (
              <a key={n.label} href={n.href} className={navLink}>{n.label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-space-sm sm:gap-space-md">
            <Link to="/login" className="hidden sm:inline-flex px-space-md py-space-sm rounded-lg font-label-lg text-label-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-low transition-colors">Sign In</Link>
            <Link to="/register" className="relative inline-flex items-center justify-center px-space-sm min-[420px]:px-space-md sm:px-space-lg py-space-sm rounded-xl font-label-lg text-label-lg text-on-primary bg-gradient-to-r from-primary via-primary-container to-secondary shadow-[0_8px_24px_-2px_rgba(121,87,255,0.35)] hover:shadow-[0_12px_28px_-2px_rgba(121,87,255,0.48)] hover:brightness-105 transition-all duration-200 active:scale-95">
              <span className="font-bold whitespace-nowrap">Get Started</span>
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="xl:hidden w-10 h-10 rounded-lg flex items-center justify-center text-on-surface hover:bg-surface-container-low transition-colors"
            >
              <Icon name={menuOpen ? "close" : "menu"} className="text-[24px]" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="relative xl:hidden bg-white/60 backdrop-blur-2xl">
            <nav aria-label="Mobile" className={`${CONTAINER} flex flex-col gap-space-2xs py-space-md`}>
              {NAV.map((n) => (
                <a key={n.label} href={n.href} onClick={() => setMenuOpen(false)} className={`${navLink} text-title-md`}>{n.label}</a>
              ))}
              <Link to="/login" onClick={() => setMenuOpen(false)} className={`${navLink} text-left sm:hidden`}>Sign In</Link>
            </nav>
          </div>
        )}
      </header>

      <main id="top" className="w-full pt-20 bg-background">
        <div className="flex flex-col w-full">
          {/* ── Hero ── */}
          <section className="relative w-full overflow-hidden bg-gradient-to-b from-[#120e3a] via-[#1a1854] to-background text-on-primary">
            <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[980px] max-w-none h-[540px] bg-gradient-to-tr from-primary-container via-secondary to-tertiary-fixed opacity-30 blur-[130px] pointer-events-none rounded-full" />
            <div className="absolute top-48 -left-36 w-96 h-96 bg-primary opacity-25 blur-[120px] pointer-events-none rounded-full" />
            <div className="absolute top-64 -right-36 w-[420px] h-[420px] bg-tertiary-fixed-dim opacity-20 blur-[110px] pointer-events-none rounded-full" />

            <div className={`relative z-10 ${CONTAINER} pt-space-2xl md:pt-space-3xl pb-space-2xl flex flex-col items-center text-center`}>
              <div className="inline-flex max-w-full items-center gap-space-xs px-space-md py-space-xs rounded-full bg-surface-container-lowest/10 backdrop-blur-md shadow-[0_4px_24px_-2px_rgba(121,87,255,0.4)] mb-space-lg">
                <span className="w-2 h-2 shrink-0 rounded-full bg-tertiary-fixed-dim animate-pulse" />
                <span className="font-label-caps text-label-caps text-primary-fixed uppercase tracking-widest font-extrabold">Next-Generation Enterprise Workspace</span>
                <Icon name="auto_awesome" className="hidden sm:inline text-tertiary-fixed-dim text-[14px]" />
              </div>

              <h1 className="font-display-hero-mobile text-display-hero-mobile md:font-display-hero md:text-display-hero max-w-5xl tracking-tight text-on-primary font-extrabold mb-space-lg drop-shadow-sm">
                The Intelligent Workspace for Every{" "}
                <span className="bg-gradient-to-r from-primary-fixed via-tertiary-fixed to-secondary-fixed bg-clip-text text-transparent">Team, Asset &amp; Operation.</span>
              </h1>

              <p className="font-body-lg text-body-lg text-secondary-fixed max-w-3xl mb-space-xl opacity-90">
                Unify high-velocity workforce management, location-verified attendance, multi-entity projects, and automated payroll into one breathtaking command center.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-space-md mb-space-xl w-full sm:w-auto">
                <Link to="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-xl py-space-md rounded-xl font-label-lg text-label-lg text-on-primary bg-gradient-to-r from-primary-container via-primary to-secondary shadow-[0_16px_36px_-6px_rgba(121,87,255,0.55)] hover:shadow-[0_20px_42px_-4px_rgba(121,87,255,0.7)] hover:brightness-110 active:scale-95 transition-all duration-200">
                  <span>Get Started Free</span>
                  <Icon name="arrow_forward" className="text-[18px]" />
                </Link>
                <a href="#interactive-preview" className="w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-xl py-space-md rounded-xl font-label-lg text-label-lg text-on-primary bg-surface-container-lowest/10 backdrop-blur-xl hover:bg-surface-container-lowest/20 shadow-[0_8px_24px_rgba(0,0,0,0.2)] transition-all duration-200">
                  <Icon name="play_circle" className="text-tertiary-fixed-dim text-[20px]" />
                  <span>Explore Interactive Demo</span>
                </a>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-x-space-lg gap-y-space-xs font-label-md text-label-md text-primary-fixed-dim/80 mb-space-2xl">
                {TRUST.map((t, i) => (
                  <span key={t.text} className="inline-flex items-center gap-space-xs">
                    {i > 0 && <span className="hidden lg:inline opacity-40 -ml-space-sm mr-space-xs">•</span>}
                    <Icon name={t.icon} className="text-tertiary-fixed text-[16px]" /> {t.text}
                  </span>
                ))}
              </div>

              {/* 3D product console */}
              <div className="w-full max-w-6xl mx-auto relative [perspective:2000px] mt-space-md">
                <div className="absolute inset-x-12 bottom-6 h-56 bg-gradient-to-r from-primary via-secondary to-tertiary-container opacity-40 blur-[80px] -z-10 rounded-full" />
                <div className="w-full rounded-2xl bg-surface-container-lowest/90 backdrop-blur-2xl text-on-surface shadow-[0_32px_96px_-16px_rgba(18,14,58,0.45),0_0_0_1px_rgba(255,255,255,0.7)] p-space-md md:p-space-lg md:[transform:rotateX(7deg)_scale(0.98)] md:hover:[transform:rotateX(0deg)_scale(1)] transition-transform duration-700 ease-out text-left">
                  <div className="flex flex-wrap items-center justify-between gap-space-md pb-space-md mb-space-md">
                    <div className="flex flex-wrap items-center gap-space-md">
                      <div className="flex items-center gap-space-2xs">
                        <span className="w-3 h-3 rounded-full bg-error/80 inline-block" />
                        <span className="w-3 h-3 rounded-full bg-secondary-fixed inline-block" />
                        <span className="w-3 h-3 rounded-full bg-tertiary-fixed inline-block" />
                      </div>
                      <div className="flex items-center gap-space-xs px-space-sm py-space-2xs rounded-lg bg-surface-container-high text-on-surface font-label-md text-label-md">
                        <Icon name="apartment" className="text-primary text-[16px]" />
                        <span className="font-bold">Apex Global Holdings</span>
                        <Icon name="expand_more" className="text-on-surface-variant text-[14px]" />
                      </div>
                      <div className="hidden lg:flex items-center gap-space-2xs text-on-surface-variant font-label-caps text-label-caps uppercase">
                        <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
                        <span>Active Nodes: Dubai • London • Karachi</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-space-sm">
                      <div className="hidden sm:inline-flex items-center gap-space-2xs px-space-sm py-space-2xs rounded-lg bg-tertiary-fixed/30 text-tertiary font-label-md text-label-md">
                        <Icon name="wifi_tethering" className="text-[16px]" />
                        <span>Telemetry Synchronized</span>
                      </div>
                      <div className="flex items-center gap-space-xs px-space-sm py-space-2xs rounded-lg bg-primary-fixed text-on-primary-fixed font-label-md text-label-md font-bold">
                        <Icon name="bolt" className="text-[16px]" />
                        <span>Fleet Velocity 99.8%</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-space-md">
                    {/* Radar card */}
                    <div className="md:col-span-5 rounded-xl bg-surface-container-lowest p-space-md shadow-sm relative overflow-hidden flex flex-col justify-between">
                      <div className="flex items-start justify-between gap-space-sm mb-space-sm">
                        <div>
                          <span className="font-label-caps text-label-caps uppercase text-on-surface-variant font-bold">On-Site Perimeter</span>
                          <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">98.4% Verified</h3>
                        </div>
                        <div className="flex shrink-0 items-center gap-space-2xs px-space-xs py-space-2xs bg-tertiary-fixed/30 rounded-full text-tertiary font-label-caps text-label-caps">
                          <span className="w-2 h-2 rounded-full bg-tertiary animate-ping" />
                          <span>Geofence Active</span>
                        </div>
                      </div>
                      <div className="relative w-full h-44 flex items-center justify-center my-space-xs">
                        <svg className="w-40 h-40 text-primary-container/20" viewBox="0 0 200 200" role="img" aria-label="Attendance radar">
                          <defs>
                            <linearGradient id="radarGradient" x1="0%" x2="100%" y1="0%" y2="0%">
                              <stop offset="0%" stopColor="#29D7E8" stopOpacity="0" />
                              <stop offset="100%" stopColor="#29D7E8" stopOpacity="1" />
                            </linearGradient>
                          </defs>
                          <circle cx="100" cy="100" fill="none" r="90" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" />
                          <circle cx="100" cy="100" fill="none" r="60" stroke="currentColor" strokeWidth="1.5" />
                          <circle cx="100" cy="100" fill="none" r="30" stroke="currentColor" strokeWidth="2" />
                          <circle className="fill-primary" cx="100" cy="100" r="8" />
                          <line stroke="url(#radarGradient)" strokeWidth="2" x1="100" x2="190" y1="100" y2="100">
                            <animateTransform attributeName="transform" dur="4s" from="0 100 100" repeatCount="indefinite" to="360 100 100" type="rotate" />
                          </line>
                          <circle className="fill-tertiary-container" cx="130" cy="80" r="4" />
                          <circle className="fill-tertiary-container" cx="70" cy="120" r="4" />
                          <circle className="fill-secondary-container" cx="120" cy="140" r="3.5" />
                          <circle className="fill-primary" cx="65" cy="75" r="3.5" />
                        </svg>
                        <div className="absolute bottom-1 right-2 text-right">
                          <span className="font-label-caps text-label-caps text-on-surface-variant block">Sync Drift</span>
                          <span className="font-headline-sm text-headline-sm text-primary font-extrabold">±0.4s</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-space-2xs pt-space-xs text-center">
                        {[["Headcount", "1,842", "text-on-surface"], ["Remote", "412", "text-secondary"], ["Exceptions", "0", "text-tertiary"]].map(([l, v, c]) => (
                          <div key={l} className="p-space-2xs bg-surface-container rounded-lg">
                            <span className="font-label-caps text-label-caps text-on-surface-variant block">{l}</span>
                            <span className={`font-title-md text-title-md font-bold ${c}`}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Throughput + badges */}
                    <div className="md:col-span-7 flex flex-col gap-space-md">
                      <div className="rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
                        <div className="flex items-center justify-between gap-space-sm mb-space-sm">
                          <div>
                            <span className="font-label-caps text-label-caps uppercase text-on-surface-variant font-bold">Enterprise Velocity</span>
                            <h4 className="font-title-md text-title-md text-on-surface font-bold">Operational Throughput &amp; Automation</h4>
                          </div>
                          <span className="shrink-0 font-label-md text-label-md font-bold px-space-xs py-space-2xs bg-primary-fixed text-on-primary-fixed rounded-md">+38.2% MoM</span>
                        </div>
                        <div className="w-full h-28">
                          <svg className="w-full h-full overflow-visible" viewBox="0 0 500 120" preserveAspectRatio="none" role="img" aria-label="Throughput trend">
                            <defs>
                              <linearGradient id="curveGradient" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#7957FF" stopOpacity="0.35" />
                                <stop offset="100%" stopColor="#3878FF" stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            <path d="M 0,90 Q 70,80 130,55 T 260,40 T 380,20 T 500,8 L 500,120 L 0,120 Z" fill="url(#curveGradient)" />
                            <path d="M 0,90 Q 70,80 130,55 T 260,40 T 380,20 T 500,8" fill="none" stroke="#6039e5" strokeLinecap="round" strokeWidth="3.5" vectorEffect="non-scaling-stroke" />
                          </svg>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-sm">
                        <div className="rounded-xl bg-surface-container-low p-space-sm flex items-center gap-space-sm">
                          <div className="w-10 h-10 shrink-0 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center text-primary">
                            <Icon name="laptop_mac" className="text-[22px]" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-title-md text-title-md font-bold block truncate">MacBook Pro M3 Max</span>
                            <span className="font-label-caps text-label-caps text-tertiary font-bold uppercase">RFID Verified • Asset #409</span>
                          </div>
                        </div>
                        <div className="rounded-xl bg-surface-container-low p-space-sm flex items-center gap-space-sm">
                          <div className="w-10 h-10 shrink-0 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-center text-secondary">
                            <Icon name="payments" className="text-[22px]" />
                          </div>
                          <div className="min-w-0">
                            <span className="font-title-md text-title-md font-bold block truncate">Global Batch Payroll</span>
                            <span className="font-label-caps text-label-caps text-on-surface-variant font-bold uppercase">Auto-Reconciled • $1.84M</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Trusted by ── */}
          <section className="w-full bg-surface-container-low/70 py-space-xl relative overflow-hidden">
            <div className={CONTAINER}>
              <p className="text-center mb-space-md font-label-caps text-label-caps uppercase tracking-wider text-on-surface-variant font-bold">
                Trusted by high-growth global enterprises &amp; mission-critical operations
              </p>
              <div className="flex flex-wrap items-center justify-center gap-space-sm md:gap-space-xl">
                {BRANDS.map((b) => (
                  <div key={b.name} className="px-space-md py-space-xs rounded-full bg-surface-container-lowest shadow-sm flex items-center gap-space-2xs text-on-surface font-title-md text-title-md font-bold">
                    <Icon name={b.icon} className={`${b.color} text-[20px]`} />
                    <span>{b.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Features ── */}
          <section id="solutions" className="w-full bg-background py-space-3xl relative scroll-mt-20">
            <div className={CONTAINER}>
              <div className="max-w-3xl mb-space-2xl">
                <div className="inline-flex items-center px-space-sm py-space-2xs rounded-full bg-primary-fixed text-on-primary-fixed font-label-caps text-label-caps uppercase font-bold mb-space-sm">
                  Unified Enterprise Architecture
                </div>
                <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg font-extrabold text-on-surface tracking-tight mb-space-xs">
                  Engineered for Deep Operational Clarity.
                </h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant">
                  Six foundational systems combined into one fluid interface. Zero fragmented silos, zero latency.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-lg">
                {FEATURES.map((f) => (
                  <div key={f.title} className="group relative rounded-2xl bg-surface-container-lowest p-space-lg shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col justify-between overflow-hidden">
                    <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${f.bar}`} />
                    <div>
                      <div className={`w-12 h-12 rounded-xl bg-gradient-to-tr ${f.iconBg} text-on-primary flex items-center justify-center mb-space-md shadow-md`}>
                        <Icon name={f.icon} className="text-[26px]" />
                      </div>
                      <div className={`inline-block px-space-xs py-space-2xs rounded-md ${f.tagCls} font-label-caps text-label-caps font-bold mb-space-xs uppercase`}>{f.tag}</div>
                      <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface mb-space-xs">{f.title}</h3>
                      <p className="font-body-md text-body-md text-on-surface-variant mb-space-md">{f.body}</p>
                    </div>
                    {f.demo}
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Interactive console ── */}
          <section id="interactive-preview" className="w-full bg-[#130f37] text-on-primary py-space-3xl relative overflow-hidden scroll-mt-20">
            <div className="absolute -top-40 right-10 w-[600px] h-[600px] bg-primary opacity-20 blur-[130px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-40 left-10 w-[600px] h-[600px] bg-tertiary-fixed-dim opacity-15 blur-[140px] rounded-full pointer-events-none" />
            <div className={`${CONTAINER} relative z-10`}>
              <div className="text-center max-w-3xl mx-auto mb-space-xl">
                <span className="inline-block px-space-sm py-space-2xs rounded-full bg-primary-container/30 text-tertiary-fixed-dim font-label-caps text-label-caps uppercase font-bold mb-space-sm">
                  Interactive Operational Console
                </span>
                <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg font-extrabold tracking-tight mb-space-xs">
                  Command Every Vector from a Single Dynamic Canvas.
                </h2>
                <p className="font-body-lg text-body-lg text-secondary-fixed opacity-90">
                  Click across functional layers to simulate live organizational data flow and control loops.
                </p>
              </div>

              <div className="flex items-center justify-center mb-space-xl">
                <div role="tablist" aria-label="Console layers" className="inline-flex p-space-xs rounded-2xl bg-surface-container-lowest/10 backdrop-blur-xl border border-outline-variant/30 overflow-x-auto max-w-full">
                  {TABS.map((t, i) => (
                    <button
                      key={t.label}
                      type="button"
                      role="tab"
                      aria-selected={tab === i}
                      onClick={() => setTab(i)}
                      className={`shrink-0 whitespace-nowrap px-space-md py-space-xs rounded-xl font-label-lg text-label-lg font-bold transition-all ${tab === i ? "bg-primary-container text-on-primary shadow-md" : "text-secondary-fixed hover:text-on-primary"}`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl bg-surface-container-lowest/10 backdrop-blur-2xl border border-outline-variant/20 p-space-md md:p-space-xl shadow-[0_32px_120px_-16px_rgba(0,0,0,0.6)]">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-center">
                  <div className="lg:col-span-7 bg-surface-container-lowest/5 rounded-2xl p-space-md border border-outline-variant/10">
                    <div className="flex flex-wrap items-center justify-between gap-space-xs mb-space-md">
                      <div className="flex items-center gap-space-xs">
                        <span className="w-3 h-3 rounded-full bg-tertiary-fixed-dim animate-pulse" />
                        <span className="font-label-caps text-label-caps uppercase text-secondary-fixed tracking-wider font-bold">{active.status}</span>
                      </div>
                      <span className="text-on-primary font-label-md text-label-md">Refresh: 100ms</span>
                    </div>
                    <div className="w-full h-56 sm:h-72">
                      <svg className="w-full h-full" viewBox="0 0 600 280" role="img" aria-label="Network of regional nodes">
                        <path d="M 50,140 Q 180,40 300,140 T 550,140" fill="none" stroke="rgba(121, 87, 255, 0.35)" strokeDasharray="6 6" strokeWidth="2" />
                        <path d="M 50,200 Q 180,260 300,140 T 550,80" fill="none" stroke="rgba(41, 215, 232, 0.3)" strokeWidth="2" />
                        <circle className="fill-primary" cx="300" cy="140" opacity="0.3" r="32" />
                        <circle className="fill-primary-container" cx="300" cy="140" r="22" />
                        <text fill="#ffffff" fontSize="12" fontWeight="700" textAnchor="middle" x="300" y="145">CORE</text>
                        <circle className="fill-secondary-container" cx="100" cy="80" r="16" />
                        <text fill="#dae2ff" fontSize="11" fontWeight="600" textAnchor="middle" x="100" y="112">DUBAI</text>
                        <circle className="fill-tertiary-container" cx="140" cy="220" r="16" />
                        <text fill="#dae2ff" fontSize="11" fontWeight="600" textAnchor="middle" x="140" y="250">LONDON</text>
                        <circle className="fill-primary" cx="500" cy="90" r="16" />
                        <text fill="#dae2ff" fontSize="11" fontWeight="600" textAnchor="middle" x="500" y="122">KARACHI</text>
                        <circle className="fill-tertiary" cx="480" cy="210" r="16" />
                        <text fill="#dae2ff" fontSize="11" fontWeight="600" textAnchor="middle" x="480" y="240">SINGAPORE</text>
                        <circle className="fill-tertiary-fixed" cx="100" cy="80" r="4">
                          <animate attributeName="cx" dur="3s" repeatCount="indefinite" values="100;300;500" />
                          <animate attributeName="cy" dur="3s" repeatCount="indefinite" values="80;140;90" />
                        </circle>
                      </svg>
                    </div>
                    <div className="grid grid-cols-1 min-[480px]:grid-cols-3 gap-space-sm pt-space-sm text-center">
                      {active.stats.map(([l, v, c]) => (
                        <div key={l} className="p-space-xs bg-surface-container-lowest/10 rounded-xl">
                          <span className="font-label-caps text-label-caps text-secondary-fixed block">{l}</span>
                          <span className={`font-title-md text-title-md font-bold ${c}`}>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="lg:col-span-5 flex flex-col gap-space-md">
                    <div>
                      <span className="font-label-caps text-label-caps text-tertiary-fixed uppercase font-bold tracking-wider">{active.eyebrow}</span>
                      <h3 className="font-headline-md text-headline-md font-bold mt-space-2xs mb-space-xs">{active.title}</h3>
                      <p className="font-body-md text-body-md text-secondary-fixed">{active.body}</p>
                    </div>
                    <div className="space-y-space-sm">
                      {active.points.map((p) => (
                        <div key={p.title} className="p-space-sm rounded-xl bg-surface-container-lowest/10 flex items-center justify-between gap-space-sm">
                          <div className="flex items-center gap-space-sm min-w-0">
                            <Icon name={p.icon} className={`${p.color} text-[24px] shrink-0`} />
                            <div className="min-w-0">
                              <h5 className="font-title-md text-title-md font-bold">{p.title}</h5>
                              <p className="font-body-sm text-body-sm text-secondary-fixed">{p.sub}</p>
                            </div>
                          </div>
                          <span className={`shrink-0 font-headline-sm text-headline-sm font-bold ${p.color}`}>{p.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Geofenced attendance ── */}
          <section id="analytics" className="w-full bg-surface-container-lowest py-space-3xl relative scroll-mt-20">
            <div className={CONTAINER}>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-xl lg:gap-space-2xl items-center">
                <div className="lg:col-span-6 relative">
                  <div className="rounded-3xl bg-surface-container-high p-space-md sm:p-space-lg relative overflow-hidden shadow-lg">
                    <div className="relative w-full h-80 rounded-2xl bg-surface-container flex items-center justify-center overflow-hidden">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(41,215,232,0.18)_0%,transparent_70%)]" />
                      <div className="w-72 h-72 rounded-full border border-tertiary/20 flex items-center justify-center">
                        <div className="w-52 h-52 rounded-full border border-tertiary/40 flex items-center justify-center">
                          <div className="w-32 h-32 rounded-full border border-tertiary flex items-center justify-center bg-tertiary/5 relative">
                            <span className="w-4 h-4 rounded-full bg-tertiary animate-ping" />
                            <span className="absolute w-3 h-3 rounded-full bg-tertiary" />
                          </div>
                        </div>
                      </div>
                      <div className="absolute top-6 left-3 sm:top-12 sm:left-16 px-space-xs py-space-2xs bg-surface-container-lowest rounded-lg shadow-md flex items-center gap-space-2xs font-label-caps text-label-caps font-bold text-on-surface">
                        <span className="w-2 h-2 rounded-full bg-tertiary" />
                        <span>Dev Center 01: 340 On-Site</span>
                      </div>
                      <div className="absolute bottom-6 right-3 sm:bottom-12 sm:right-14 px-space-xs py-space-2xs bg-surface-container-lowest rounded-lg shadow-md flex items-center gap-space-2xs font-label-caps text-label-caps font-bold text-on-surface">
                        <span className="w-2 h-2 rounded-full bg-secondary" />
                        <span>Logistics Bay B: 120 On-Site</span>
                      </div>
                    </div>
                    <div className="mt-space-md flex flex-wrap items-center justify-between gap-space-sm">
                      <div className="flex items-center gap-space-xs text-on-surface">
                        <Icon name="security" className="text-tertiary text-[20px]" />
                        <span className="font-label-lg text-label-lg font-bold">Zero-Tracking Outside Designated Geofences</span>
                      </div>
                      <span className="px-space-sm py-space-2xs rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-caps text-label-caps font-extrabold uppercase">Privacy Guaranteed</span>
                    </div>
                  </div>
                </div>

                <div id="security" className="lg:col-span-6 flex flex-col gap-space-md scroll-mt-28">
                  <div className="inline-flex items-center px-space-sm py-space-2xs rounded-full bg-tertiary-fixed text-on-tertiary-fixed font-label-caps text-label-caps uppercase font-bold w-fit">
                    Precision Attendance Engine
                  </div>
                  <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg font-extrabold text-on-surface tracking-tight">
                    Geofencing That Respects Employee Dignity &amp; Privacy.
                  </h2>
                  <p className="font-body-lg text-body-lg text-on-surface-variant">
                    Eliminate intrusive constant-location surveillance. ManagementDock uses zero-knowledge peripheral validation: the system checks coordinates only when an employee explicitly triggers a check-in event within pre-approved polygon operational perimeters.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md pt-space-xs">
                    {[
                      { icon: "offline_pin", color: "text-primary", title: "Offline Fallback Sync", body: "Store cryptographic timestamp receipts locally during connectivity outages. Automatic reconciliation on reconnect." },
                      { icon: "fingerprint", color: "text-secondary", title: "Anti-Spoof Defense", body: "Hardware-level GPS signal validation and biometric corroboration reject emulators and fake location attacks." },
                    ].map((c) => (
                      <div key={c.title} className="p-space-md rounded-xl bg-surface-container-low">
                        <div className={`w-8 h-8 rounded-lg bg-surface-container-lowest flex items-center justify-center ${c.color} mb-space-xs shadow-sm`}>
                          <Icon name={c.icon} className="text-[20px]" />
                        </div>
                        <h4 className="font-title-md text-title-md font-bold mb-space-2xs">{c.title}</h4>
                        <p className="font-body-sm text-body-sm text-on-surface-variant">{c.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ── Pricing (live plans from the app) ── */}
          <section id="pricing" className="w-full bg-background py-space-3xl relative overflow-hidden scroll-mt-20">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] max-w-none h-[500px] bg-primary-fixed/30 rounded-full blur-[140px] pointer-events-none" />
            <div className={`${CONTAINER} relative z-10`}>
              <div className="text-center max-w-2xl mx-auto mb-space-2xl">
                <span className="inline-block px-space-sm py-space-2xs rounded-full bg-surface-container-highest text-primary font-label-caps text-label-caps uppercase font-bold mb-space-sm">
                  Simple Pricing
                </span>
                <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg font-extrabold text-on-surface tracking-tight mb-space-xs">
                  Start free. Scale as your team grows.
                </h2>
                <p className="font-body-lg text-body-lg text-on-surface-variant">
                  Transparent monthly plans. Upgrade, downgrade or talk to us whenever your needs change.
                </p>
              </div>

              {plansLoading ? (
                <div className="flex justify-center py-space-2xl">
                  <div className="flex items-center gap-space-sm rounded-full bg-surface-container-lowest px-space-lg py-space-sm text-on-surface-variant shadow-sm">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-primary" /> Loading plans…
                  </div>
                </div>
              ) : plans.length === 0 ? (
                <p className="text-center text-on-surface-variant">Plans are unavailable right now. Please check back shortly.</p>
              ) : (
                <div className={`grid grid-cols-1 gap-space-lg items-stretch ${plans.length <= 3 ? "lg:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
                  {plans.map((plan) => {
                    const sale = plan.sale
                    const cta = plan.isCustom ? "Sign In to Contact Us" : plan.effectivePriceCents === 0 ? `Get ${plan.name} Free` : `Get ${plan.name}`
                    return (
                      <div
                        key={plan.key}
                        className={`relative rounded-2xl bg-surface-container-lowest p-space-lg flex flex-col justify-between ${plan.recommended ? "shadow-[0_20px_50px_-8px_rgba(121,87,255,0.25)] xl:-translate-y-2 mt-space-md md:mt-0" : "shadow-sm"}`}
                      >
                        {plan.recommended && (
                          <>
                            <div className="absolute z-10 -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap px-space-md py-space-2xs bg-gradient-to-r from-primary to-secondary text-on-primary rounded-full font-label-caps text-label-caps uppercase font-extrabold tracking-wider shadow-md">
                              Recommended
                            </div>
                            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-primary via-primary-container to-secondary rounded-t-2xl" />
                          </>
                        )}
                        <div className={plan.recommended ? "pt-space-xs" : ""}>
                          <div className="flex flex-wrap items-center justify-between gap-space-xs mb-space-sm">
                            <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{plan.name}</h3>
                            <span className={`px-space-xs py-space-2xs rounded font-label-caps text-label-caps font-bold uppercase ${plan.recommended ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-container text-on-surface-variant"}`}>{limitLabel(plan)}</span>
                          </div>
                          {sale && (
                            <span className="inline-block mb-space-xs rounded-full bg-error-container px-space-xs py-space-2xs font-label-caps text-label-caps font-bold uppercase text-on-error-container">
                              {sale.label || "Sale"} · {sale.percent}% off
                            </span>
                          )}
                          <p className="font-body-md text-body-md text-on-surface-variant mb-space-md min-h-[44px]">{plan.description}</p>
                          <div className="mb-space-lg">
                            {plan.isCustom ? (
                              <span className="font-headline-lg text-headline-lg font-extrabold text-on-surface">Custom</span>
                            ) : (
                              <>
                                <span className={`font-headline-lg text-headline-lg font-extrabold ${plan.recommended ? "bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent" : "text-on-surface"}`}>{formatMoney(plan.effectivePriceCents, plan.currency)}</span>
                                <span className="font-body-md text-body-md text-on-surface-variant"> / month</span>
                                {sale && <p className="font-body-sm text-body-sm text-on-surface-variant line-through">{formatMoney(plan.priceCents, plan.currency)}</p>}
                              </>
                            )}
                          </div>
                          <ul className="space-y-space-sm font-body-md text-body-md text-on-surface mb-space-xl">
                            {plan.features.map((it) => (
                              <li key={it} className="flex items-start gap-space-xs">
                                <Icon name="check" className="text-primary text-[18px] mt-[2px]" /> <span>{it}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <Link to={plan.isCustom ? "/login" : "/register"} className={BTN + " w-full py-space-md"}>
                          {cta}
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── Final CTA ── */}
          <section className="w-full bg-gradient-to-tr from-[#120e3a] via-primary-container to-secondary text-on-primary py-space-3xl relative overflow-hidden">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-tertiary-fixed-dim/30 rounded-full blur-[110px] pointer-events-none" />
            <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-primary/40 rounded-full blur-[110px] pointer-events-none" />
            <div className={`${CONTAINER} relative z-10 text-center flex flex-col items-center`}>
              <div className="inline-flex items-center gap-space-xs px-space-md py-space-2xs rounded-full bg-surface-container-lowest/15 backdrop-blur-md mb-space-md">
                <span className="w-2 h-2 rounded-full bg-tertiary-fixed-dim" />
                <span className="font-label-caps text-label-caps uppercase tracking-wider text-secondary-fixed font-bold">Unify Your Fleet Today</span>
              </div>
              <h2 className="font-display-hero-mobile text-display-hero-mobile md:font-display-hero md:text-display-hero font-extrabold max-w-4xl tracking-tight mb-space-md">
                Bring your entire organization into focus.
              </h2>
              <p className="font-body-lg text-body-lg text-secondary-fixed max-w-2xl mb-space-xl opacity-90">
                Connect your people, projects, attendance, and operations in one intelligent workspace. Start with full platform capabilities in minutes.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-space-md w-full sm:w-auto">
                <Link to="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-xl py-space-md rounded-xl font-label-lg text-label-lg text-on-primary bg-gradient-to-r from-primary to-secondary shadow-[0_12px_32px_rgba(121,87,255,0.5)] hover:shadow-[0_16px_40px_rgba(121,87,255,0.7)] hover:brightness-110 active:scale-95 transition-all">
                  <span>Get Started Free</span>
                  <Icon name="arrow_forward" className="text-[18px]" />
                </Link>
                <Link to="/login" className="w-full sm:w-auto inline-flex items-center justify-center gap-space-xs px-space-xl py-space-md rounded-xl font-label-lg text-label-lg text-on-primary bg-surface-container-lowest/10 backdrop-blur-md hover:bg-surface-container-lowest/20 transition-all">
                  <Icon name="login" className="text-[18px]" />
                  <span>Sign In to Your Workspace</span>
                </Link>
              </div>
              <div className="mt-space-2xl pt-space-md flex flex-wrap items-center justify-center gap-x-space-lg gap-y-space-xs text-secondary-fixed font-label-md text-label-md opacity-75">
                <span>Instant Sandbox Provisioning</span>
                <span className="hidden md:inline">•</span>
                <span>Zero Credit Card Required</span>
                <span className="hidden md:inline">•</span>
                <span>Dedicated Enterprise Migration Assistance</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="w-full bg-surface-container-low border-t border-outline-variant/30 text-on-surface-variant relative overflow-hidden">
        <div className="absolute -top-24 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 right-1/4 w-96 h-96 bg-tertiary-fixed-dim/15 rounded-full blur-3xl pointer-events-none" />
        <div className={`${CONTAINER} pt-space-3xl pb-space-xl relative z-10`}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-gutter">
            <div className="col-span-2 lg:pr-space-xl">
              <div className="flex items-center gap-space-sm mb-space-md">
                <img src={logoFull} alt="ManagementDock" className="h-8 w-8 rounded-lg object-contain" />
                <span className="font-headline-sm text-headline-sm tracking-tight text-on-surface font-extrabold">Management<span className="text-primary">Dock</span></span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant mb-space-lg max-w-sm">
                High-velocity enterprise operations infrastructure engineering unified intelligence, autonomous control loops, and mission-critical orchestrations.
              </p>
              <div className="inline-flex items-center gap-space-2xs px-space-sm py-space-2xs bg-surface-container-highest rounded-full font-label-caps text-label-caps text-on-surface">
                <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />Global Systems Operational
              </div>
            </div>
            {FOOTER_COLS.map((col) => (
              <div key={col.title} className="col-span-2 min-[480px]:col-span-1">
                <p className="font-label-caps text-label-caps uppercase text-on-surface font-bold tracking-wider mb-space-md">{col.title}</p>
                <ul className="flex flex-col gap-space-sm font-body-md text-body-md">
                  {col.links.map((l) => (
                    <li key={l}><a href="#top" className="hover:text-primary transition-colors">{l}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-space-2xl pt-space-lg border-t border-outline-variant/20 flex flex-col md:flex-row items-center justify-between gap-space-md text-center md:text-left">
            <p className="font-body-sm text-body-sm text-on-surface-variant">© {new Date().getFullYear()} ManagementDock Systems Inc. Engineered for mission-critical operations.</p>
            <div className="flex flex-wrap items-center justify-center gap-x-space-lg gap-y-space-xs font-body-sm text-body-sm">
              <a className="hover:text-primary transition-colors" href="#top">Security Policy</a>
              <a className="hover:text-primary transition-colors" href="#top">Service Level Agreements</a>
              <a className="hover:text-primary transition-colors" href="#top">Privacy Architecture</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
