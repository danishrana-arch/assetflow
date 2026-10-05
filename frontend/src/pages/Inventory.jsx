import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"
import {
  Search, Plus, X, Upload, FileDown, FileOutput, Trash2, Pencil, Eye, Ellipsis, ArrowUp, ArrowDown, ArrowUpDown,
  LayoutGrid, List, SlidersHorizontal, Calendar, Package, Laptop, Monitor, PcCase, Headphones, FileText,
  Smartphone, Armchair, HardDrive, Webcam, Keyboard, ShieldCheck, Tablet, Projector, Printer, Mouse, Cable,
  Wrench, TriangleAlert, ArrowLeftRight, RotateCcw, CirclePlus, ArrowUpRight, ChevronLeft, ChevronRight,
} from "lucide-react"
import api from "../api/client"
import BackButton from "../components/ui/BackButton"
import { useAuth } from "../context/AuthContext"
import StatusPill from "../components/ui/StatusPill"
import Avatar from "../components/ui/Avatar"
import { TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const PAGE_SIZES = [10, 25, 50]
// Any spreadsheet the backend can read (utils/sheet.js): Excel, Google Sheets
// downloads, CSV/TSV.
const SHEET_ACCEPT = ".xlsx,.xlsm,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
const VIEW_KEY = "assetflow_inventory_view"

const emptyForm = {
  name: "", category: "", customCategory: "", serialNumber: "", cpu: "", ram: "", storage: "",
  purchaseDate: "", warrantyEnd: "", departmentId: "",
}

// Asset statuses as the inventory page names them.
const STATUS_META = {
  ASSIGNED: { label: "In Use", tone: "green", color: "#16A34A" },
  AVAILABLE: { label: "Available", tone: "blue", color: "#2563EB" },
  REPAIR: { label: "Maintenance", tone: "orange", color: "#F59E0B" },
  LOST: { label: "Lost", tone: "pink", color: "#DC2626" },
  DISPOSED: { label: "Disposed", tone: "slate", color: "#8A9393" },
}

// CSV of the given assets. The first nine columns match the import template,
// so an exported sheet can be edited and imported again.
function csvCell(value) {
  const text = String(value ?? "")
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
const dayOf = (value) => (value ? String(value).slice(0, 10) : "")
function downloadAssetsCsv(rows) {
  const header = ["Name", "Category", "Serial Number", "CPU", "RAM", "Storage", "Purchase Date", "Warranty End", "Department", "Status", "Assigned To", "Added On"]
  const lines = rows.map((a) => [
    a.name,
    a.category,
    a.serialNumber,
    a.cpu,
    a.ram,
    a.storage,
    dayOf(a.purchaseDate),
    dayOf(a.warrantyEnd),
    a.department?.name,
    STATUS_META[a.status]?.label || a.status,
    a.assignedTo?.name,
    dayOf(a.createdAt),
  ].map(csvCell).join(","))
  const blob = new Blob([`﻿${[header.join(","), ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// Keyword → icon/tone, so custom categories still get a sensible icon.
const CATEGORY_ICONS = [
  [["laptop", "notebook"], Laptop, "blue"],
  [["desktop", "pc", "computer", "cpu"], PcCase, "blue"],
  [["monitor", "screen", "display"], Monitor, "purple"],
  [["headset", "headphone"], Headphones, "cyan"],
  [["stationery", "stationary", "paper"], FileText, "green"],
  [["phone", "mobile"], Smartphone, "cyan"],
  [["furniture", "chair", "desk"], Armchair, "orange"],
  [["drive", "hdd", "ssd", "storage"], HardDrive, "slate"],
  [["webcam", "camera"], Webcam, "purple"],
  [["keyboard"], Keyboard, "yellow"],
  [["license", "software"], ShieldCheck, "green"],
  [["tablet", "ipad"], Tablet, "pink"],
  [["projector"], Projector, "cyan"],
  [["printer", "scanner"], Printer, "slate"],
  [["mouse"], Mouse, "yellow"],
  [["dock", "cable", "adapter", "charger"], Cable, "orange"],
  [["accessor"], Headphones, "purple"],
]

function categoryIcon(cat) {
  const c = (cat || "").toLowerCase()
  for (const [keys, icon, tone] of CATEGORY_ICONS) if (keys.some((k) => c.includes(k))) return { icon, tone }
  return { icon: Package, tone: "orange" }
}

const TONE_CHIP = {
  blue: "bg-chip-blue-bg text-chip-blue-fg",
  purple: "bg-chip-purple-bg text-chip-purple-fg",
  cyan: "bg-chip-cyan-bg text-chip-cyan-fg",
  orange: "bg-chip-orange-bg text-chip-orange-fg",
  green: "bg-chip-green-bg text-chip-green-fg",
  pink: "bg-chip-pink-bg text-chip-pink-fg",
  yellow: "bg-chip-yellow-bg text-chip-yellow-fg",
  slate: "bg-chip-slate-bg text-chip-slate-fg",
}

// Stat tiles; `status` is what clicking the tile filters the table to.
const STAT_TILES = [
  {
    key: "total", label: "Total Assets", status: "", icon: Package, stroke: "#16A34A",
    tile: "bg-chip-green-bg/25 border-chip-green-bg/70 dark:bg-chip-green-bg/[0.05] dark:border-chip-green-bg/10",
    iconCls: "bg-chip-green-bg text-chip-green-fg dark:bg-chip-green-bg/15 dark:text-chip-green-bg",
  },
  {
    key: "inUse", label: "In Use", status: "ASSIGNED", icon: Laptop, stroke: "#2563EB",
    tile: "bg-chip-blue-bg/30 border-chip-blue-bg/80 dark:bg-chip-blue-bg/[0.06] dark:border-chip-blue-bg/10",
    iconCls: "bg-chip-blue-bg text-chip-blue-fg dark:bg-chip-blue-bg/15 dark:text-chip-blue-bg",
  },
  {
    key: "repair", label: "Under Maintenance", status: "REPAIR", icon: Wrench, stroke: "#F59E0B",
    tile: "bg-chip-orange-bg/35 border-chip-orange-bg dark:bg-chip-orange-bg/[0.06] dark:border-chip-orange-bg/10",
    iconCls: "bg-chip-orange-bg text-chip-orange-fg dark:bg-chip-orange-bg/15 dark:text-chip-orange-bg",
  },
  {
    key: "lost", label: "Lost / Disposed", status: "LOST,DISPOSED", icon: TriangleAlert, stroke: "#DC2626",
    tile: "bg-chip-pink-bg/30 border-chip-pink-bg/80 dark:bg-chip-pink-bg/[0.06] dark:border-chip-pink-bg/10",
    iconCls: "bg-chip-pink-bg text-chip-pink-fg dark:bg-chip-pink-bg/15 dark:text-chip-pink-bg",
  },
]

const ACTIVITY_META = {
  PURCHASED: { icon: CirclePlus, tone: "green" },
  ASSIGNED: { icon: ArrowUpRight, tone: "green" },
  UNASSIGNED: { icon: ArrowLeftRight, tone: "blue" },
  RETURNED: { icon: ArrowLeftRight, tone: "blue" },
  REPAIR_STARTED: { icon: Wrench, tone: "orange" },
  REPAIR_COMPLETED: { icon: RotateCcw, tone: "purple" },
  UPGRADED: { icon: RotateCcw, tone: "purple" },
  WARRANTY_EXPIRED: { icon: TriangleAlert, tone: "yellow" },
  DISPOSED: { icon: Trash2, tone: "pink" },
  NOTE: { icon: Pencil, tone: "slate" },
}

function useDebouncedValue(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function formatDate(value) {
  if (!value) return null
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function timeAgo(value) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(value)
}

function pct(part, whole) {
  return whole ? ((part / whole) * 100).toFixed(1) : "0.0"
}

function Sparkline({ points, stroke }) {
  if (!points || points.length < 2) return null
  const max = Math.max(...points), min = Math.min(...points)
  const span = max - min || 1
  const d = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
    .join(" ")
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SortHeader({ label, field, sort, onSort }) {
  const active = sort.field === field
  const Icon = !active ? ArrowUpDown : sort.order === "asc" ? ArrowUp : ArrowDown
  return (
    <button type="button" onClick={() => onSort(field)} className={`inline-flex items-center gap-1 hover:text-ink ${active ? "text-ink" : ""}`}>
      {label} <Icon size={12} className={active ? "" : "opacity-50"} />
    </button>
  )
}

function AssetStatus({ status }) {
  const m = STATUS_META[status] || { label: status, tone: "slate" }
  return <StatusPill tone={m.tone} className="!normal-case !tracking-normal">{m.label}</StatusPill>
}

function CategoryPill({ category }) {
  if (!category) return <span className="text-muted-2">—</span>
  const { tone } = categoryIcon(category)
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TONE_CHIP[tone]}`}>{category}</span>
}

// Floating panel rendered in a portal so table/scroll containers can't clip it.
function usePopover() {
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
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
  function toggle(width, height) {
    if (pos) return setPos(null)
    const r = ref.current.getBoundingClientRect()
    const top = r.bottom + height + 8 > window.innerHeight ? Math.max(8, r.top - height - 4) : r.bottom + 4
    setPos({ top, left: Math.min(window.innerWidth - width - 8, Math.max(8, r.right - width)), width })
  }
  return { pos, ref, toggle, close: () => setPos(null) }
}

function Floating({ pop, children }) {
  if (!pop.pos) return null
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={pop.close} />
      <div
        style={{ top: pop.pos.top, left: pop.pos.left, width: pop.pos.width }}
        className="fixed z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-card"
      >
        {children}
      </div>
    </>,
    document.body
  )
}

function RowMenu({ asset, onEdit, onDelete }) {
  const pop = usePopover()
  const navigate = useNavigate()
  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
  return (
    <>
      <button
        ref={pop.ref}
        type="button"
        onClick={() => pop.toggle(170, 124)}
        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        aria-label={`Actions for ${asset.name}`}
        aria-expanded={!!pop.pos}
      >
        <Ellipsis size={16} />
      </button>
      <Floating pop={pop}>
        <div role="menu" className="py-1">
          <button className={`${item} text-ink`} onClick={() => { pop.close(); navigate(`/inventory/${asset.id}`) }}>
            <Eye size={14} /> View details
          </button>
          <button className={`${item} text-ink`} onClick={() => { pop.close(); onEdit(asset) }}>
            <Pencil size={14} /> Edit
          </button>
          <button className={`${item} text-danger`} onClick={() => { pop.close(); onDelete(asset) }}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </Floating>
    </>
  )
}

function FilterMenu({ status, departmentId, warranty, departments, onChange, onClear }) {
  const pop = usePopover()
  const count = [status, departmentId, warranty].filter(Boolean).length
  return (
    <>
      <button
        ref={pop.ref}
        type="button"
        onClick={() => pop.toggle(260, 280)}
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${count ? "border-accent text-accent" : "border-border text-muted hover:text-ink"}`}
      >
        <SlidersHorizontal size={14} /> Filter by{count ? ` (${count})` : ""}
      </button>
      <Floating pop={pop}>
        <div className="space-y-3 p-4">
          <SelectField label="Status" value={status} onChange={(e) => onChange("status", e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
            <option value="LOST,DISPOSED">Lost / Disposed</option>
          </SelectField>
          <SelectField label="Department" value={departmentId} onChange={(e) => onChange("departmentId", e.target.value)}>
            <option value="">All departments</option>
            {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </SelectField>
          <SelectField label="Warranty" value={warranty} onChange={(e) => onChange("warranty", e.target.value)}>
            <option value="">Any</option>
            <option value="expiring">Expiring in 30 days</option>
            <option value="expired">Expired</option>
          </SelectField>
          <div className="flex justify-between pt-1">
            <button type="button" onClick={onClear} className="text-xs font-semibold text-muted hover:text-ink">Clear all</button>
            <button type="button" onClick={pop.close} className="pill-accent px-3.5 py-1.5 text-xs">Done</button>
          </div>
        </div>
      </Floating>
    </>
  )
}

export default function Inventory() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  // ADMIN/CEO may delete an asset that's still assigned (it's unassigned
  // automatically); other inventory roles must unassign it first.
  const canDeleteAssigned = ["ADMIN", "CEO"].includes(user?.role)

  // Dashboard stat cards deep-link here: ?warranty=expiring (Warranty Alerts)
  // and ?view=all (Total Assets — "All" is now the default view anyway).
  const [searchParams, setSearchParams] = useSearchParams()
  const warranty = searchParams.get("warranty") || ""
  function setParam(key, value) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const [q, setQ] = useState("")
  const debouncedQ = useDebouncedValue(q)
  const [category, setCategory] = useState("")
  const [status, setStatus] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [sort, setSort] = useState({ field: "updatedAt", order: "desc" })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState(() => new Set())
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list" } catch { return "list" }
  })
  const [activityLimit, setActivityLimit] = useState(6)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [actionNotice, setActionNotice] = useState("")
  const [importResult, setImportResult] = useState(null)
  const [importError, setImportError] = useState("")
  const fileInputRef = useRef(null)

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view) } catch { /* storage unavailable */ }
  }, [view])

  useEffect(() => { setPage(1); setSelected(new Set()) }, [debouncedQ, category, status, departmentId, warranty, sort, pageSize])

  const listParams = {
    q: debouncedQ || undefined,
    category: category || undefined,
    status: status || undefined,
    departmentId: departmentId || undefined,
    warranty: warranty || undefined,
    sort: sort.field,
    order: sort.order,
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["assets", listParams, page, pageSize],
    queryFn: () => api.get("/assets", { params: { ...listParams, page, pageSize } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  const assets = data?.data || []

  const { data: summary } = useQuery({
    queryKey: ["assets", "summary", activityLimit],
    queryFn: () => api.get("/assets/summary", { params: { activity: activityLimit } }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })
  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
  })
  const { data: categories } = useQuery({
    queryKey: ["asset-categories"],
    queryFn: () => api.get("/assets/categories").then((r) => r.data),
  })

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["assets"] })
    queryClient.invalidateQueries({ queryKey: ["asset"] })
    queryClient.invalidateQueries({ queryKey: ["asset-categories"] })
  }

  const deleteAsset = useMutation({
    mutationFn: (asset) => api.delete(`/assets/${asset.id}`),
    onSuccess: (_, asset) => {
      invalidateAll()
      queryClient.invalidateQueries({ queryKey: ["employees"] })
      queryClient.invalidateQueries({ queryKey: ["employee"] })
      setSelected((s) => { const n = new Set(s); n.delete(asset.id); return n })
      setActionError("")
      setActionNotice(asset.assignedTo ? `${asset.name} deleted and unassigned from ${asset.assignedTo.name}.` : `${asset.name} deleted.`)
    },
    onError: (err) => { setActionNotice(""); setActionError(err.response?.data?.error || "Could not delete asset") },
  })

  const deleteCategory = useMutation({
    mutationFn: (name) => api.delete(`/assets/categories/${encodeURIComponent(name)}`),
    onSuccess: () => { invalidateAll(); setCategory("") },
    onError: (err) => setActionError(err.response?.data?.error || "Could not remove category"),
  })

  // One form for both Add and Edit (editingId set = editing that asset).
  const saveAsset = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        category: form.category === "__custom__" ? form.customCategory.trim() : form.category,
        customCategory: undefined,
      }
      return editingId
        ? api.patch(`/assets/${editingId}`, { ...payload, departmentId: form.departmentId || null })
        : api.post("/assets", { ...payload, departmentId: form.departmentId || undefined })
    },
    onSuccess: (res) => {
      invalidateAll()
      setActionError("")
      setActionNotice(editingId ? `${res.data.name} updated.` : `${res.data.name} added.`)
      closeForm()
    },
    onError: (err) => setError(err.response?.data?.error || (editingId ? "Could not update asset" : "Could not create asset")),
  })

  const importFile = useMutation({
    mutationFn: (file) => {
      const formData = new FormData()
      formData.append("file", file)
      return api.post("/assets/import", formData, { headers: { "Content-Type": "multipart/form-data" } })
    },
    onSuccess: (res) => { invalidateAll(); setImportResult(res.data); setImportError("") },
    onError: (err) => setImportError(err.response?.data?.error || "Could not import that file"),
  })

  function closeForm() { setShowForm(false); setEditingId(null); setForm(emptyForm); setError("") }

  function startEdit(asset) {
    const knownCategory = !asset.category || (categories || []).some((c) => c.name === asset.category)
    setForm({
      name: asset.name || "",
      category: knownCategory ? asset.category || "" : "__custom__",
      customCategory: knownCategory ? "" : asset.category,
      serialNumber: asset.serialNumber || "",
      cpu: asset.cpu || "", ram: asset.ram || "", storage: asset.storage || "",
      purchaseDate: asset.purchaseDate ? String(asset.purchaseDate).slice(0, 10) : "",
      warrantyEnd: asset.warrantyEnd ? String(asset.warrantyEnd).slice(0, 10) : "",
      departmentId: asset.departmentId || asset.department?.id || "",
    })
    setEditingId(asset.id); setError(""); setShowForm(true)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function updateField(key, value) { setForm((f) => ({ ...f, [key]: value })) }

  // Exports the selected rows, or else every asset matching the current
  // filters (all pages — GET /assets without `page` returns the full list).
  const [exporting, setExporting] = useState(false)
  async function handleExport() {
    setImportError("")
    if (selected.size > 0) return downloadAssetsCsv(assets.filter((a) => selected.has(a.id)))
    setExporting(true)
    try {
      const res = await api.get("/assets", { params: listParams })
      downloadAssetsCsv(Array.isArray(res.data) ? res.data : res.data?.data || [])
    } catch (err) {
      setImportError(err.response?.data?.error || "Could not export the inventory")
    } finally {
      setExporting(false)
    }
  }

  async function handleTemplate() {
    try {
      const res = await api.get("/assets/import/template", { responseType: "blob" })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement("a")
      a.href = url
      a.download = "asset-import-template.csv"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setImportError("Could not download the template")
    }
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = "" // allow re-selecting the same file later
    if (!file) return
    setImportResult(null)
    setImportError("")
    importFile.mutate(file)
  }

  function handleDeleteAsset(asset) {
    const holder = asset.assignedTo?.name
    if (holder && !canDeleteAssigned) {
      setActionNotice("")
      setActionError(`${asset.name} is assigned to ${holder}. Unassign it first — only Admin or CEO can delete an assigned asset.`)
      return
    }
    const message = holder
      ? `${asset.name} is assigned to ${holder}. Deleting it will unassign it from ${holder} automatically and remove it permanently. Continue?`
      : `Delete ${asset.name}? This cannot be undone.`
    if (!window.confirm(message)) return
    deleteAsset.mutate(asset)
  }

  async function handleDeleteSelected() {
    const chosen = assets.filter((a) => selected.has(a.id))
    const targets = chosen.filter((a) => canDeleteAssigned || !a.assignedTo)
    const skipped = chosen.length - targets.length
    if (targets.length === 0) {
      setActionNotice("")
      setActionError("The selected assets are all assigned. Unassign them first — only Admin or CEO can delete an assigned asset.")
      return
    }
    const assignedCount = targets.filter((a) => a.assignedTo).length
    const msg = `Delete ${targets.length} asset${targets.length > 1 ? "s" : ""}?` +
      (assignedCount ? ` ${assignedCount} of them will be unassigned automatically.` : "") +
      (skipped ? ` ${skipped} assigned asset${skipped > 1 ? "s" : ""} will be skipped.` : "") +
      " This cannot be undone."
    if (!window.confirm(msg)) return
    const failed = []
    for (const a of targets) {
      try { await api.delete(`/assets/${a.id}`) } catch (err) { failed.push(`${a.name}: ${err.response?.data?.error || "could not delete"}`) }
    }
    setSelected(new Set())
    invalidateAll()
    queryClient.invalidateQueries({ queryKey: ["employees"] })
    if (failed.length) { setActionNotice(""); setActionError(failed.join(" · ")) }
    else { setActionError(""); setActionNotice(`${targets.length} asset${targets.length > 1 ? "s" : ""} deleted.${skipped ? ` ${skipped} skipped (assigned).` : ""}`) }
  }

  function handleDeleteCategory() {
    if (!category) return
    if (!window.confirm(`Remove category "${category}" from all assets? This will clear the label but not delete assets.`)) return
    deleteCategory.mutate(category)
  }

  function toggleSort(field) {
    setSort((s) => (s.field === field ? { field, order: s.order === "asc" ? "desc" : "asc" } : { field, order: "asc" }))
  }
  function setFilter(key, value) {
    if (key === "status") setStatus(value)
    if (key === "departmentId") setDepartmentId(value)
    if (key === "warranty") setParam("warranty", value)
  }
  function clearFilters() { setStatus(""); setDepartmentId(""); setParam("warranty", null) }

  const allOnPageSelected = assets.length > 0 && assets.every((a) => selected.has(a.id))
  function toggleAll() { setSelected(allOnPageSelected ? new Set() : new Set(assets.map((a) => a.id))) }
  function toggleOne(id) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n }) }

  const counts = summary?.statusCounts || {}
  const total = summary?.total ?? 0
  const tileValue = {
    total,
    inUse: counts.ASSIGNED || 0,
    repair: counts.REPAIR || 0,
    lost: (counts.LOST || 0) + (counts.DISPOSED || 0),
  }
  const growth = summary
    ? summary.totalLastMonth
      ? `${((summary.addedThisMonth / summary.totalLastMonth) * 100).toFixed(0)}%`
      : summary.addedThisMonth ? "new" : "0%"
    : null
  const donut = Object.entries(STATUS_META)
    .map(([key, m]) => ({ key, ...m, value: counts[key] || 0 }))
  const todayLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const hasFilters = !!(q || category || status || departmentId || warranty)
  const showingFrom = data?.total ? (data.page - 1) * data.pageSize + 1 : 0
  const showingTo = data?.total ? showingFrom + assets.length - 1 : 0

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <BackButton />
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-chip-green-bg text-chip-green-fg dark:bg-chip-green-bg/15 dark:text-chip-green-bg">
            <Package size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink sm:text-3xl">Inventory</h1>
            <p className="text-sm text-muted">Track and manage all your organization assets, equipment and inventory.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importFile.isPending}
            className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm disabled:opacity-60"
          >
            <Upload size={14} /> {importFile.isPending ? "Importing…" : "Import Sheet"}
          </button>
          <input ref={fileInputRef} type="file" accept={SHEET_ACCEPT} onChange={handleFileChosen} className="hidden" />
          <button
            onClick={handleTemplate}
            className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm"
            title="Download a CSV with every column the import understands"
          >
            <FileDown size={14} /> Import Template
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="pill-secondary flex items-center gap-1.5 px-3.5 py-2.5 text-sm disabled:opacity-60"
            title="Download the assets shown (current filters, or the selected rows) as a sheet"
          >
            <FileOutput size={14} /> {exporting ? "Exporting…" : selected.size > 0 ? `Export ${selected.size} selected` : "Export Sheet"}
          </button>
          <button
            onClick={() => (showForm ? closeForm() : setShowForm(true))}
            className="pill-accent flex items-center gap-1.5 px-4 py-2.5 text-sm"
          >
            {showForm ? <X size={15} /> : <Plus size={15} />}
            {showForm ? "Cancel" : "Add Asset"}
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <CategoryScroller activeKey={category} itemCount={categories?.length || 0}>
        <button onClick={() => { setCategory(""); setParam("view", null) }} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap ${!category ? "folder-tab-active" : "tab-pill"}`}>
          <LayoutGrid size={14} /> All
          <span className={!category ? "opacity-80" : "text-muted-2"}>({total})</span>
        </button>
        {(categories || []).map((c) => {
          const { icon: Icon } = categoryIcon(c.name)
          const active = category === c.name
          return (
            <button key={c.name} onClick={() => { setCategory(c.name); setParam("view", null) }} className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap ${active ? "folder-tab-active" : "tab-pill"}`}>
              <Icon size={14} /> {c.name}
              <span className={active ? "opacity-80" : "text-muted-2"}>({c.count})</span>
            </button>
          )
        })}
        {category && (
          <button type="button" onClick={handleDeleteCategory} className="tab-pill flex shrink-0 items-center gap-2 text-danger" title={`Remove the "${category}" category`}>
            <Trash2 size={14} />
          </button>
        )}
      </CategoryScroller>

      {actionError && (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {actionNotice && (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-chip-green-bg px-3.5 py-2.5 text-sm text-chip-green-fg">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice("")} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}
      {importError && (
        <div className="rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">{importError}</div>
      )}
      {importResult && (
        <div className="card space-y-2 border-l-[6px] border-l-chip-blue-fg p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              Import finished — {importResult.createdCount} added, {importResult.skippedCount} skipped.
            </p>
            <button onClick={() => setImportResult(null)} className="text-muted hover:text-ink" aria-label="Dismiss"><X size={15} /></button>
          </div>
          {importResult.created?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-surface-2 p-3 text-xs">
              {importResult.created.map((c) => (
                <p key={c.row} className="text-muted">
                  Row {c.row}: <span className="font-medium text-ink">{c.name}</span> — {c.serialNumber}
                </p>
              ))}
            </div>
          )}
          {importResult.skipped?.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-xl bg-chip-yellow-bg p-3 text-xs text-chip-yellow-fg">
              {importResult.skipped.map((s, i) => <p key={i}>Row {s.row}: {s.reason}</p>)}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const categoryOk = form.category === "__custom__" ? form.customCategory.trim() : true
            if (form.name.trim() && form.serialNumber.trim() && categoryOk) saveAsset.mutate()
          }}
          className="card space-y-4 p-5"
        >
          <p className="text-sm font-semibold text-ink">{editingId ? `Edit ${form.name || "asset"}` : "Add asset"}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <TextField label="Name *" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="Dell Latitude 7440" required />
            <TextField label="Serial number *" value={form.serialNumber} onChange={(e) => updateField("serialNumber", e.target.value)} required />
            {form.category === "__custom__" ? (
              <TextField
                label="New category name"
                value={form.customCategory || ""}
                onChange={(e) => updateField("customCategory", e.target.value)}
                placeholder="e.g. Office Furniture"
                hint={
                  <button type="button" onClick={() => { updateField("category", ""); updateField("customCategory", "") }} className="font-medium text-accent hover:underline">
                    Choose an existing category instead
                  </button>
                }
                required
              />
            ) : (
              <SelectField label="Category" value={form.category} onChange={(e) => updateField("category", e.target.value)}>
                <option value="">Select a category</option>
                {(categories || []).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                <option value="__custom__">+ Add new category…</option>
              </SelectField>
            )}
            <TextField label="CPU" value={form.cpu} onChange={(e) => updateField("cpu", e.target.value)} />
            <TextField label="RAM" value={form.ram} onChange={(e) => updateField("ram", e.target.value)} placeholder="16GB" />
            <TextField label="Storage" value={form.storage} onChange={(e) => updateField("storage", e.target.value)} placeholder="512GB SSD" />
            <SelectField label="Department" value={form.departmentId} onChange={(e) => updateField("departmentId", e.target.value)}>
              <option value="">None</option>
              {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <TextField label="Purchase date" type="date" value={form.purchaseDate} onChange={(e) => updateField("purchaseDate", e.target.value)} />
            <TextField label="Warranty end" type="date" value={form.warrantyEnd} onChange={(e) => updateField("warrantyEnd", e.target.value)} />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={saveAsset.isPending} className="pill-accent px-5 py-2.5 text-sm disabled:opacity-60">
              {saveAsset.isPending ? "Saving…" : editingId ? "Save changes" : "Add asset"}
            </button>
            <button type="button" onClick={closeForm} className="pill-secondary px-5 py-2.5 text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left: stat tiles + table */}
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {STAT_TILES.map((t) => {
              const Icon = t.icon
              const value = tileValue[t.key]
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setStatus(t.status)}
                  aria-pressed={status === t.status}
                  className={`flex min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-all hover:-translate-y-px hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${t.tile} ${
                    status === t.status && t.status ? "ring-2 ring-accent" : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.iconCls}`}>
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-muted">{t.label}</p>
                      <p className="text-2xl font-bold text-ink">{summary ? value.toLocaleString() : "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <p className="text-[11px] text-muted">
                      {t.key === "total" ? (
                        summary ? (
                          <>
                            <span className="font-semibold text-success">+{summary.addedThisMonth}</span>
                            {growth !== "new" && growth !== "0%" ? <span className="text-success"> ({growth})</span> : null} this month
                          </>
                        ) : "—"
                      ) : (
                        <><span className="font-semibold" style={{ color: t.stroke }}>{pct(value, total)}%</span> of all assets</>
                      )}
                    </p>
                    {t.key === "total" && <Sparkline points={summary?.trend?.map((p) => p.total)} stroke={t.stroke} />}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="card overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
              <div className="flex w-full max-w-xs items-center gap-2 rounded-xl border border-border bg-surface px-3">
                <Search size={15} className="shrink-0 text-muted-2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search assets, serial, holder…"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted-2"
                  aria-label="Search assets"
                />
                {q && <button onClick={() => setQ("")} className="text-muted hover:text-ink" aria-label="Clear search"><X size={14} /></button>}
              </div>
              <div className="flex items-center gap-2">
                <FilterMenu
                  status={status}
                  departmentId={departmentId}
                  warranty={warranty}
                  departments={departments}
                  onChange={setFilter}
                  onClear={clearFilters}
                />
                <div className="flex rounded-xl border border-border p-0.5">
                  <button
                    type="button"
                    onClick={() => setView("grid")}
                    className={`rounded-lg p-1.5 ${view === "grid" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
                    aria-label="Grid view"
                    aria-pressed={view === "grid"}
                  >
                    <LayoutGrid size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("list")}
                    className={`rounded-lg p-1.5 ${view === "list" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}
                    aria-label="List view"
                    aria-pressed={view === "list"}
                  >
                    <List size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Active filter chips */}
            {(status || departmentId || warranty) && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                {status && (
                  <FilterChip onClear={() => setStatus("")}>
                    Status: {status === "LOST,DISPOSED" ? "Lost / Disposed" : STATUS_META[status]?.label}
                  </FilterChip>
                )}
                {departmentId && (
                  <FilterChip onClear={() => setDepartmentId("")}>
                    Department: {(departments || []).find((d) => d.id === departmentId)?.name || "—"}
                  </FilterChip>
                )}
                {warranty && (
                  <FilterChip onClear={() => setParam("warranty", null)}>
                    {warranty === "expired" ? "Warranty expired" : "Warranty expiring in 30 days"}
                  </FilterChip>
                )}
              </div>
            )}

            {selected.size > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2 px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">{selected.size} selected</span>
                <div className="flex items-center gap-3">
                  <button onClick={handleDeleteSelected} className="flex items-center gap-1.5 text-xs font-semibold text-danger hover:underline">
                    <Trash2 size={13} /> Delete selected
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-muted hover:text-ink">Clear</button>
                </div>
              </div>
            )}

            {isLoading && <p className="p-5 text-sm text-muted">Loading...</p>}

            {!isLoading && assets.length === 0 && (
              <div className="p-5">
                <EmptyState
                  icon={Package}
                  title={hasFilters ? "No assets match these filters" : "No assets yet"}
                  description={hasFilters ? "Try a different keyword, category or filter." : "Add your first asset or import a CSV to get started."}
                />
              </div>
            )}

            {/* Grid view (also used on phones) */}
            {assets.length > 0 && (
              <div className={`grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3 ${view === "grid" ? "" : "md:hidden"}`}>
                {assets.map((asset) => {
                  const { icon: Icon, tone } = categoryIcon(asset.category)
                  return (
                    <div key={asset.id} className={`rounded-2xl border p-4 transition-colors ${selected.has(asset.id) ? "border-accent" : "border-border"}`}>
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={selected.has(asset.id)}
                          onChange={() => toggleOne(asset.id)}
                          aria-label={`Select ${asset.name}`}
                          className="mt-1 h-4 w-4 cursor-pointer accent-[var(--accent)]"
                        />
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${TONE_CHIP[tone]}`}><Icon size={20} /></div>
                        <Link to={`/inventory/${asset.id}`} className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink hover:text-accent">{asset.name}</p>
                          <p className="truncate font-mono text-[11px] text-muted-2">{asset.serialNumber}</p>
                        </Link>
                        <RowMenu asset={asset} onEdit={startEdit} onDelete={handleDeleteAsset} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <CategoryPill category={asset.category} />
                        <AssetStatus status={asset.status} />
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
                        <span className="truncate">{asset.assignedTo?.name || "Unassigned"}</span>
                        <span className="shrink-0">{formatDate(asset.purchaseDate) || "—"}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* List view */}
            {assets.length > 0 && view === "list" && (
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs font-semibold text-muted">
                    <tr className="border-b border-border bg-surface-2">
                      <th className="w-10 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          onChange={toggleAll}
                          aria-label="Select all on this page"
                          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                        />
                      </th>
                      <th className="px-3 py-3"><SortHeader label="Asset ID" field="serialNumber" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3"><SortHeader label="Asset Name" field="name" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3"><SortHeader label="Category" field="category" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3"><SortHeader label="Assigned To" field="assignedTo" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3"><SortHeader label="Status" field="status" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3"><SortHeader label="Purchase Date" field="purchaseDate" sort={sort} onSort={toggleSort} /></th>
                      <th className="px-3 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => {
                      const { icon: Icon, tone } = categoryIcon(asset.category)
                      const specs = [asset.cpu, asset.ram, asset.storage].filter(Boolean).join(" · ")
                      return (
                        <tr key={asset.id} className={`border-b border-border last:border-0 transition-colors hover:bg-surface-2 ${selected.has(asset.id) ? "bg-accent-soft" : ""}`}>
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={selected.has(asset.id)}
                              onChange={() => toggleOne(asset.id)}
                              aria-label={`Select ${asset.name}`}
                              className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
                            />
                          </td>
                          <td className="max-w-[140px] truncate px-3 py-3 font-mono text-xs text-ink" title={asset.serialNumber}>{asset.serialNumber}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-3">
                              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONE_CHIP[tone]}`}><Icon size={17} /></div>
                              <div className="min-w-0">
                                <Link to={`/inventory/${asset.id}`} className="block truncate font-medium text-ink hover:text-accent">{asset.name}</Link>
                                {specs && <p className="truncate text-[11px] text-muted-2">{specs}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3"><CategoryPill category={asset.category} /></td>
                          <td className="px-3 py-3">
                            {asset.assignedTo ? (
                              <Link to={`/employees/${asset.assignedTo.id}`} className="flex items-center gap-2.5">
                                <Avatar name={asset.assignedTo.name} size="xs" />
                                <div className="min-w-0">
                                  <p className="truncate text-ink hover:text-accent">{asset.assignedTo.name}</p>
                                  <p className="truncate text-[11px] text-muted-2">
                                    {asset.assignedTo.designation || asset.assignedTo.department?.name || asset.department?.name || ""}
                                  </p>
                                </div>
                              </Link>
                            ) : (
                              <span className="text-muted-2">Unassigned</span>
                            )}
                          </td>
                          <td className="px-3 py-3"><AssetStatus status={asset.status} /></td>
                          <td className="whitespace-nowrap px-3 py-3 text-ink">{formatDate(asset.purchaseDate) || <span className="text-muted-2">—</span>}</td>
                          <td className="px-3 py-3 text-right">
                            <RowMenu asset={asset} onEdit={startEdit} onDelete={handleDeleteAsset} />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Footer: pagination + page size */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
              <PageNumbers
                page={data?.page || 1}
                totalPages={data?.totalPages || 1}
                onPageChange={(p) => { setPage(p); setSelected(new Set()) }}
              />
              <div className="flex items-center gap-3 text-xs text-muted">
                <span>Showing {showingFrom} to {showingTo} of {data?.total || 0} items</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-ink"
                  aria-label="Items per page"
                >
                  {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} / page</option>)}
                </select>
              </div>
            </div>
            {isFetching && !isLoading && <p className="pb-2 text-center text-xs text-muted-2">Refreshing…</p>}
          </div>
        </div>

        {/* Right: summary + activity */}
        <div className="space-y-5">
          <div className="card p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Inventory Summary</h2>
              <span className="flex items-center gap-1.5 text-xs text-muted"><Calendar size={13} /> Today, {todayLabel}</span>
            </div>
            <div className="flex items-center gap-5">
              <div className="relative h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={total ? donut.filter((d) => d.value > 0) : [{ key: "empty", value: 1, color: "var(--border)" }]}
                      dataKey="value"
                      nameKey="label"
                      innerRadius="72%"
                      outerRadius="100%"
                      paddingAngle={total ? 2 : 0}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {(total ? donut.filter((d) => d.value > 0) : [{ key: "empty", color: "var(--border)" }]).map((d) => (
                        <Cell key={d.key} fill={d.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold text-ink">{total}</span>
                  <span className="text-[11px] text-muted">Total Assets</span>
                </div>
              </div>
              <ul className="min-w-0 flex-1 space-y-2.5">
                {donut.map((d) => (
                  <li key={d.key}>
                    <button
                      type="button"
                      onClick={() => setStatus(d.key)}
                      className="flex w-full items-center gap-2 text-left text-sm hover:opacity-80"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color }} />
                      <span className="flex-1 truncate text-ink">{d.label}</span>
                      <span className="font-semibold text-ink">{d.value}</span>
                      <span className="w-11 text-right text-xs text-muted">{pct(d.value, total)}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-ink">Recent Activity</h2>
              {(summary?.activity?.length || 0) >= 6 && (
                <button
                  type="button"
                  onClick={() => setActivityLimit((l) => (l > 6 ? 6 : 30))}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  {activityLimit > 6 ? "Show less" : "View all"}
                </button>
              )}
            </div>
            {summary?.activity?.length ? (
              <ul className={`space-y-1 ${activityLimit > 6 ? "max-h-[480px] overflow-y-auto pr-1" : ""}`}>
                {summary.activity.map((e) => {
                  const meta = ACTIVITY_META[e.type] || ACTIVITY_META.NOTE
                  const Icon = meta.icon
                  return (
                    <li key={e.id}>
                      <Link to={`/inventory/${e.asset.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE_CHIP[meta.tone]}`}><Icon size={16} /></div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{e.asset.name}</p>
                          <p className="truncate text-xs text-muted">
                            {e.note || e.type.replace(/_/g, " ").toLowerCase()}
                            {e.actor?.name ? ` · by ${e.actor.name}` : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-2">{timeAgo(e.occurredAt)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted">No asset activity yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// One-row, horizontally scrolling tab strip with ‹ › buttons at both ends.
// Arrows disable at the ends; the active tab is scrolled into view.
function CategoryScroller({ activeKey, itemCount, children }) {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  function update() {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }))
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Tabs load/change, or a different tab becomes active: re-measure and
  // bring the active tab into view (only then — never while the user scrolls).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const active = el.querySelector(".folder-tab-active")
    if (active) {
      const a = active.getBoundingClientRect(), c = el.getBoundingClientRect()
      if (a.left < c.left || a.right > c.right) el.scrollLeft += a.left < c.left ? a.left - c.left - 8 : a.right - c.right + 8
    }
    update()
  }, [activeKey, itemCount])

  function scrollBy(dir) {
    const el = ref.current
    el?.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: "smooth" })
  }

  const arrow = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-ink shadow-sm transition-opacity hover:bg-surface-2 disabled:cursor-default disabled:opacity-35"
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => scrollBy(-1)} disabled={!edges.left} className={arrow} aria-label="Scroll categories left">
        <ChevronLeft size={16} />
      </button>
      <div
        ref={ref}
        onScroll={update}
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scroll-smooth py-1"
      >
        {children}
      </div>
      <button type="button" onClick={() => scrollBy(1)} disabled={!edges.right} className={arrow} aria-label="Scroll categories right">
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

// 1 … 4 5 6 … 10 style pager.
function PageNumbers({ page, totalPages, onPageChange }) {
  const pages = []
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p)
    else if (pages[pages.length - 1] !== "…") pages.push("…")
  }
  const btn = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium"
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className={`${btn} border border-border text-muted hover:text-ink disabled:opacity-40`}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-muted-2">…</span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={`${btn} ${p === page ? "bg-accent text-white" : "text-ink hover:bg-surface-2"}`}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className={`${btn} border border-border text-muted hover:text-ink disabled:opacity-40`}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

function FilterChip({ children, onClear }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-chip-yellow-bg px-3 py-1 text-xs font-semibold text-chip-yellow-fg">
      {children}
      <button type="button" onClick={onClear} className="rounded-full p-0.5 hover:bg-black/5" aria-label="Clear filter">
        <X size={12} />
      </button>
    </span>
  )
}
