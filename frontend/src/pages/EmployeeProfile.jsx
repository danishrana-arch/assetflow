import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck, Plus, X, Boxes, Ticket as TicketIcon, Activity, UserX, Pencil, Check,
  Mail, Phone, KeyRound, Laptop, PackageSearch, MapPin,
  Calendar, Users as ManagerIcon, Send, Save, Minus,
  CalendarRange, ShieldCheck, ChevronLeft, ChevronRight, ChevronDown, Building2, Clock3,
  Briefcase, AtSign, Layers, LogIn, LogOut,
} from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { useTheme } from "../context/ThemeContext"
import { hasModuleAccess, canManageInventory, canAccessPayroll, ROLE_LABELS } from "../utils/roles"
import { formatTime, formatClock } from "../utils/time"
import StatusBadge from "../components/StatusBadge"
import ParticleText from "../components/ParticleText"
import StatusPill from "../components/ui/StatusPill"
import PageHeader from "../components/ui/PageHeader"
import ProfilePhoto from "../components/ProfilePhoto"
import IconChip from "../components/ui/IconChip"
import SectionHeader from "../components/ui/SectionHeader"
import { FieldValue, TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"
import WorkingTimeProgress from "../components/ui/WorkingTimeProgress"
import EmployeeDocuments from "../components/EmployeeDocuments"
import { nearestAssignedSite } from "../utils/siteGeofence"
import { getAttendanceDeviceId } from "../utils/offlineAttendance"

// "YYYY-MM-DD" for a moment in the given IANA timezone (browser's if unset).
function dateKeyIn(value, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined }).format(value)
}
// "YYYY-MM" shifted by whole months.
function shiftMonth(monthKey, delta) {
  const [y, m] = monthKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7)
}
function monthTitle(monthKey) {
  const [y, m] = monthKey.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
}
function dayTitle(dayKey) {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
}
const DAY_TONE = {
  PRESENT: "bg-chip-green-bg text-chip-green-fg",
  LATE: "bg-chip-yellow-bg text-chip-yellow-fg",
  ABSENT: "bg-chip-pink-bg text-chip-pink-fg",
  LEAVE: "bg-chip-blue-bg text-chip-blue-fg",
}
const LEAVE_TYPE_LABEL = { CASUAL: "Paid", SICK: "Sick", UNPAID: "Unpaid" }

function MonthNav({ monthKey, onChange, minMonth, maxMonth }) {
  const canPrev = !minMonth || monthKey > minMonth
  const canNext = !maxMonth || monthKey < maxMonth
  const btn = "flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(shiftMonth(monthKey, -1))} disabled={!canPrev} className={btn} aria-label="Previous month">
        <ChevronLeft size={14} />
      </button>
      <span className="min-w-[7.5rem] text-center text-xs font-semibold text-ink">{monthTitle(monthKey)}</span>
      <button type="button" onClick={() => onChange(shiftMonth(monthKey, 1))} disabled={!canNext} className={btn} aria-label="Next month">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

const LEVEL_LABEL = { INTERN: "Intern", JUNIOR: "Junior", SENIOR: "Senior", LEAD: "Lead" }
const REQUEST_TONE = { PENDING: "yellow", APPROVED: "blue", REJECTED: "pink", FULFILLED: "green" }
const LEVEL_TONE = { INTERN: "slate", JUNIOR: "blue", SENIOR: "green", LEAD: "yellow" }
const WORK_LOCATION_LABEL = { OFFICE: "Office", FIELD: "Field / Remote" }
const PROJECT_STATUS = {
  NOT_STARTED: { label: "Not started", tone: "slate" },
  IN_PROGRESS: { label: "In progress", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
}
const ASSET_STATUS_TONE = { ASSIGNED: "blue", AVAILABLE: "green", REPAIR: "yellow", LOST: "pink", DISPOSED: "slate" }

function fmtDate(value) {
  if (!value) return undefined
  return new Date(value).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
}

function DetailGroup({ title, children }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface-2 p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-2">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

// Big total on the left, a short dotted breakdown on the right — shared by
// the Leave Balance and Projects cards.
function SummarySplit({ total, totalLabel, totalNote, items }) {
  return (
    <div className="mt-4 flex flex-1 items-center gap-5">
      <div className="shrink-0 border-r border-border pr-5">
        <p className="text-4xl font-bold tabular-nums text-ink" style={{ letterSpacing: "-0.03em" }}>{total}</p>
        <p className="mt-1 text-xs font-medium text-muted">{totalLabel}</p>
        {totalNote && <p className="mt-0.5 text-[11px] text-muted-2">{totalNote}</p>}
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-muted">
              <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {item.value}
              {item.note && <span className="ml-1 text-[11px] font-normal text-muted-2">{item.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FormGroup({ title, children }) {
  return (
    <fieldset className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-border p-4">
      <legend className="px-1 text-[10px] font-bold uppercase tracking-wider text-muted-2">{title}</legend>
      {children}
    </fieldset>
  )
}

// Categorizes an assigned asset into a tab. Anything whose category name
// contains "laptop" (case-insensitive) goes in the Laptops tab; everything
// else — monitors, phones, accessories, etc. — goes in Accessories.
function assetTabOf(asset) {
  return (asset.category || "").toLowerCase().includes("laptop") ? "LAPTOP" : "ACCESSORY"
}

// What a viewer who isn't the employee themself (and isn't a full-access
// role like ADMIN/CEO) gets to see is scoped to their own department, so
// an IT manager reviewing someone's profile sees their equipment, HR sees
// personal/employment details, Finance sees pay details, and a direct
// manager sees the operational picture — not every field on the record.
function useProfileLens({ user, employee, isSelf }) {
  return useMemo(() => {
    if (user?.role === "IT_MANAGER") return "it"
    if (isSelf || user?.role === "ADMIN" || user?.role === "CEO") return "full"
    const dept = (user?.department?.name || "").toLowerCase()
    if (dept.includes("it") || dept.includes("tech")) return "it"
    if (dept.includes("financ") || dept.includes("account")) return "finance"
    if (dept.includes("hr") || dept.includes("people") || user?.role === "HR") return "hr"
    if (employee?.manager?.id === user?.id) return "manager"
    return "full"
  }, [user, employee, isSelf])
}

export default function EmployeeProfile() {
  const { id } = useParams()
  const { organization, user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const canManageAssets = canManageInventory(user?.role)
  const isIT = user?.role === "IT_MANAGER"
  const isSelf = user?.id === id
  const viewerIsOwnerTier = ["ADMIN", "CEO"].includes(user?.role)
  const [showAssignForm, setShowAssignForm] = useState(false)
  const [showAddAssetForm, setShowAddAssetForm] = useState(false)
  const [newAsset, setNewAsset] = useState({ name: "", category: "", serialNumber: "", cpu: "", ram: "", storage: "", purchaseDate: "", warrantyEnd: "" })
  const [selectedAssetId, setSelectedAssetId] = useState("")
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editError, setEditError] = useState("")
  const [resetResult, setResetResult] = useState(null)
  const [showRequestForm, setShowRequestForm] = useState(false)
  const [requestCategory, setRequestCategory] = useState("")
  const [requestReason, setRequestReason] = useState("")
  const [assetTab, setAssetTab] = useState("ALL")
  const [usageDrafts, setUsageDrafts] = useState({}) // { [assetId]: { notUsing: bool, actual: string } }
  const [usageSubmitted, setUsageSubmitted] = useState({}) // { [assetId]: true }
  const [certificateDrafts, setCertificateDrafts] = useState([])
  const { mode: themeMode } = useTheme()
  // Month browser shared by the Attendance and Activity cards; a clicked
  // calendar day shows that day's check-in/out (null = today).
  const [viewMonth, setViewMonthState] = useState(() => dateKeyIn(new Date(), organization?.timezone).slice(0, 7))
  const [selectedDay, setSelectedDay] = useState(null)
  const setViewMonth = (month) => { setViewMonthState(month); setSelectedDay(null) }
  const [marking, setMarking] = useState(null) // "CHECK_IN" | "CHECK_OUT" while a quick mark runs
  const [markMessage, setMarkMessage] = useState(null) // { tone: "error" | "info", text }
  const canQuickMark = isSelf && !isIT
  const { data: monthActivity, isFetching: loadingMonth } = useQuery({
    queryKey: ["employee-activity", id, viewMonth],
    queryFn: () => api.get(`/employees/${id}/activity`, { params: { month: viewMonth } }).then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: !isIT,
  })
  // Same data (and cache key) My Attendance uses for the geofence check.
  const { data: assignedSites = [] } = useQuery({
    queryKey: ["attendance-assigned-sites", user?.id],
    queryFn: () => api.get("/attendance-sites/assigned").then((r) => r.data),
    enabled: canQuickMark,
    staleTime: 5 * 60 * 1000,
  })
  const detailsRef = useRef(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
  })

  // ADMIN/CEO profiles can only be changed by an ADMIN or CEO — mirrors the
  // backend's check in updateEmployee/certification.controller.js.
  const isProtectedTarget = ["ADMIN", "CEO"].includes(employee?.role)
  const canTouchThisProfile = !isProtectedTarget || viewerIsOwnerTier || isSelf
  // Management can edit every field on anyone (including themselves); a
  // non-management viewer can only edit their own phone/email.
  const canEditFully = hasModuleAccess(user?.role, "employees") && canTouchThisProfile
  const canEditContactOnly = !canEditFully && isSelf && user?.role !== "IT_MANAGER"
  // Only the Owner (ADMIN) can remove an employee outright — and never a CEO.
  const canRemoveEmployee = user?.role === "ADMIN" && !isSelf && employee?.role !== "CEO"
  // An ADMIN editing a CEO can't demote or deactivate them (that's removal).
  const canChangeRoleAndStatus = viewerIsOwnerTier && !(employee?.role === "CEO" && user?.role !== "CEO")
  // HR may change a (non-ADMIN/CEO) employee's role to a non-owner role, but
  // not their own — mirrors updateEmployee.
  const hrCanChangeRole = user?.role === "HR" && !isSelf && !isProtectedTarget
  const canChangeRole = canChangeRoleAndStatus || hrCanChangeRole
  const canManageCertifications = (hasModuleAccess(user?.role, "certifications") || isSelf) && canTouchThisProfile
  // Employment status decides leave eligibility — ADMIN/CEO/HR only (backend: updateEmployee).
  const canEditEmploymentStatus = ["ADMIN", "CEO", "HR"].includes(user?.role)
  // Profile picture: yourself, or ADMIN/CEO/HR (an ADMIN/CEO's only by ADMIN/CEO) — backend: updateEmployeePhoto.
  const canChangePhoto = isSelf || (["ADMIN", "CEO", "HR"].includes(user?.role) && canTouchThisProfile)
  // Document pictures: the employee views their own; ADMIN/CEO/HR manage
  // (an ADMIN/CEO's only by ADMIN/CEO) — backend: employee-document.controller.
  const canManageDocuments = ["ADMIN", "CEO", "HR"].includes(user?.role) && canTouchThisProfile

  useEffect(() => {
    if (!employee) return
    // Rebuild from the server's list, keeping any not-yet-saved drafts so a
    // refetch (e.g. after saving the profile) doesn't wipe them.
    setCertificateDrafts((current) => [...(employee.certifications || []).map((certificate) => ({
      id: certificate.id,
      name: certificate.name || "",
      institute: certificate.institute || "",
      credentialId: certificate.credentialId || "",
      credentialUrl: certificate.credentialUrl || "",
      issuedDate: certificate.issuedDate ? certificate.issuedDate.slice(0, 10) : "",
      expiryDate: certificate.expiryDate ? certificate.expiryDate.slice(0, 10) : "",
      notes: certificate.notes || "",
    })), ...current.filter((draft) => !draft.id)])
  }, [employee])

  // ADMIN/CEO can reset anyone's password. HR can reset anyone's except an
  // ADMIN's or CEO's — matches the backend's controller-level check, which
  // needs the *target*'s role, not just the requester's.
  const canResetPassword =
    !isSelf &&
    (["ADMIN", "CEO"].includes(user?.role) ||
      (user?.role === "HR" && !["ADMIN", "CEO"].includes(employee?.role)))

  const lens = useProfileLens({ user, employee, isSelf })
  const showAssets = lens === "full" || lens === "it" || lens === "manager"
  const showFinancial = !isIT && (lens === "full" || lens === "finance")
  const showPersonalDetails = !isIT && (lens === "full" || lens === "hr")

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get("/departments").then((r) => r.data),
    enabled: canEditFully,
  })

  const { data: managerOptions } = useQuery({
    queryKey: ["employee-manager-options"],
    queryFn: () => api.get("/employees", { params: { page: 1, pageSize: 200, includeCompanyManagers: true } }).then((r) => r.data?.data || r.data || []),
    enabled: canEditFully,
  })

  const { data: availableAssets } = useQuery({
    queryKey: ["assets", "AVAILABLE"],
    queryFn: () => api.get("/assets", { params: { status: "AVAILABLE" } }).then((r) => r.data),
    enabled: canManageAssets && showAssignForm,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", id] })
    queryClient.invalidateQueries({ queryKey: ["assets"] })
  }

  const assignAsset = useMutation({
    mutationFn: () => api.post(`/assets/${selectedAssetId}/assign`, { employeeId: id }),
    onSuccess: () => { invalidate(); setShowAssignForm(false); setSelectedAssetId("") },
  })

  const addAndAssignAsset = useMutation({
    mutationFn: async () => {
      const created = await api.post("/assets", {
        ...newAsset,
        purchaseDate: newAsset.purchaseDate || undefined,
        warrantyEnd: newAsset.warrantyEnd || undefined,
      })
      await api.post(`/assets/${created.data.id}/assign`, { employeeId: id, note: `Added and assigned to ${employee?.name || "employee"}` })
      return created.data
    },
    onSuccess: () => {
      invalidate()
      setShowAddAssetForm(false)
      setNewAsset({ name: "", category: "", serialNumber: "", cpu: "", ram: "", storage: "", purchaseDate: "", warrantyEnd: "" })
    },
  })

  const removeAsset = useMutation({
    mutationFn: (assetId) =>
      api.post(`/assets/${assetId}/status`, {
        status: "AVAILABLE",
        eventType: "UNASSIGNED",
        note: `Unassigned from ${employee?.name || "employee"}`,
      }),
    onSuccess: invalidate,
  })

  const [certificateError, setCertificateError] = useState("")
  const saveCertification = useMutation({
    mutationFn: ({ certificateId, data }) => certificateId
      ? api.patch(`/employees/${id}/certifications/${certificateId}`, data)
      : api.post(`/employees/${id}/certifications`, data),
    onSuccess: (res, { index }) => {
      setCertificateError("")
      // Give a new draft its real id right away, so a second click updates
      // it instead of creating a duplicate, and the refetch doesn't keep a
      // second unsaved copy of it.
      setCertificateDrafts((items) => items.map((item, i) => (i === index ? { ...item, id: res.data.id } : item)))
      queryClient.invalidateQueries({ queryKey: ["employee", id] })
    },
    onError: (err) => setCertificateError(err.response?.data?.error || "Could not save certification"),
  })

  const deleteCertification = useMutation({
    mutationFn: (certificateId) => api.delete(`/employees/${id}/certifications/${certificateId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee", id] }),
  })

  const removeEmployee = useMutation({
    mutationFn: () => api.delete(`/employees/${id}`),
    onSuccess: () => navigate("/employees"),
  })

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/employees/${id}/reset-password`),
    onSuccess: (res) => setResetResult(res.data.tempPassword),
  })

  const { data: myRequests } = useQuery({
    queryKey: ["asset-requests", "mine", id],
    queryFn: () => api.get("/asset-requests").then((r) => r.data),
    enabled: isSelf,
  })

  const createRequest = useMutation({
    mutationFn: () => api.post("/asset-requests", { category: requestCategory.trim(), reason: requestReason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["asset-requests", "mine", id] })
      setShowRequestForm(false)
      setRequestCategory("")
      setRequestReason("")
    },
  })

  const cancelRequest = useMutation({
    mutationFn: (requestId) => api.delete(`/asset-requests/${requestId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["asset-requests", "mine", id] }),
  })

  // Self-service "am I actually using this?" check. Unticking reveals a
  // free-text field for what the employee is really using, and submitting
  // raises a ticket (category "Asset Discrepancy") so IT/management can
  // follow up — reuses the existing ticket queue instead of a new inbox.
  const reportUsage = useMutation({
    mutationFn: ({ asset, actual }) =>
      api.post("/tickets", {
        subject: `Not using assigned asset: ${asset.name}`,
        description: `${employee?.name || "Employee"} reported they are not currently using their assigned ${asset.name} (${asset.serialNumber}). They say they're actually using: ${actual}`,
        category: "Asset Discrepancy",
        priority: "MEDIUM",
        assetId: asset.id,
      }),
    onSuccess: (_res, variables) => {
      setUsageSubmitted((prev) => ({ ...prev, [variables.asset.id]: true }))
    },
  })

  function handleResetPassword() {
    if (!employee) return
    if (window.confirm(`Reset ${employee.name}'s password to the temporary password? They'll need to change it after logging in.`)) {
      resetPassword.mutate()
    }
  }

  const saveEdit = useMutation({
    mutationFn: (data) => api.patch(`/employees/${id}`, data),
    onSuccess: () => {
      invalidate()
      if (isSelf) refreshUser()
      setEditing(false)
      setEditError("")
    },
    onError: (err) => setEditError(err.response?.data?.error || "Could not save changes"),
  })

  function handleRemoveEmployee() {
    if (!employee) return
    if (window.confirm(`Remove ${employee.name}? This can't be undone.`)) removeEmployee.mutate()
  }

  function startEditing() {
    if (!employee) return
    setEditForm({
      name: employee.name || "",
      email: employee.email || "",
      personalEmail: employee.personalEmail || "",
      phone: employee.phone || "",
      fatherName: employee.fatherName || "",
      education: employee.education || "",
      currentUniversity: employee.currentUniversity || "",
      linkedinUrl: employee.linkedinUrl || "",
      shiftStart: employee.shiftStart || "",
      shiftEnd: employee.shiftEnd || "",
      departmentId: employee.department?.id || "",
      managerId: employee.manager?.id || "",
      role: employee.role || "EMPLOYEE",
      status: employee.status || "ACTIVE",
      cnic: employee.cnic || "",
      dob: employee.dob ? employee.dob.slice(0, 10) : "",
      address: employee.address || "",
      skill: employee.skill || "",
      seniorityLevel: employee.seniorityLevel || "",
      baseSalary: employee.baseSalary ?? "",
      bankName: employee.bankName || "",
      bankAccountNumber: employee.bankAccountNumber || "",
      designation: employee.designation || "",
      joiningDate: employee.joiningDate ? employee.joiningDate.slice(0, 10) : "",
      startDate: employee.startDate ? employee.startDate.slice(0, 10) : "",
      employmentStatus: employee.employmentStatus || "PROBATION",
      permanentDate: employee.permanentDate ? employee.permanentDate.slice(0, 10) : "",
      workLocationType: employee.workLocationType || "OFFICE",
      passportNumber: employee.passportNumber || "",
      civilNumber: employee.civilNumber || "",
      nationality: employee.nationality || "",
      agentName: employee.agentName || "",
      emergencyContactName: employee.emergencyContactName || "",
      emergencyContactRelationship: employee.emergencyContactRelationship || "",
      emergencyContactPhone: employee.emergencyContactPhone || "",
      emergencyContactAltPhone: employee.emergencyContactAltPhone || "",
      emergencyContactAddress: employee.emergencyContactAddress || "",
      emergencyContactNotes: employee.emergencyContactNotes || "",
    })
    setEditError("")
    setEditing(true)
  }

  const setField = (key) => (e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))

  function handleSaveEdit(e) {
    e.preventDefault()
    if (canEditFully) {
      saveEdit.mutate(editForm)
    } else if (canEditContactOnly) {
      saveEdit.mutate({ phone: editForm.phone, email: editForm.email })
    }
  }

  if (isLoading) return <p className="text-sm text-muted">Loading...</p>
  if (!employee) return <p className="text-sm text-muted">Employee not found.</p>

  // Today in the organization's timezone — attendance dates are stored as
  // the org-local calendar day.
  const timeZone = employee.organization?.timezone || organization?.timezone
  const todayIso = dateKeyIn(new Date(), timeZone)
  const currentMonth = todayIso.slice(0, 7)
  const dayKeyOf = (value) => String(value).slice(0, 10)
  const todayRecord = (employee.attendanceRecords || []).find((r) => r.date && dayKeyOf(r.date) === todayIso)

  const level = employee.seniorityLevel
  const levelTone = LEVEL_TONE[level] || "slate"
  const canEdit = canEditFully || canEditContactOnly

  const assignedAssets = employee.assignedAssets || []
  const laptopCount = assignedAssets.filter((a) => assetTabOf(a) === "LAPTOP").length
  const accessoryCount = assignedAssets.length - laptopCount
  // One tab per category actually assigned (plus All), so any category —
  // Tablet, Monitor, Phone… — gets its own filter.
  const categoryLabelOf = (asset) => (asset.category || "").trim() || "Uncategorized"
  const categoryKeyOf = (asset) => categoryLabelOf(asset).toLowerCase()
  const assetTabs = [{ key: "ALL", label: "All", count: assignedAssets.length }]
  for (const asset of assignedAssets) {
    const key = categoryKeyOf(asset)
    const tab = assetTabs.find((t) => t.key === key)
    if (tab) tab.count += 1
    else assetTabs.push({ key, label: categoryLabelOf(asset), count: 1 })
  }
  assetTabs.splice(1, assetTabs.length, ...assetTabs.slice(1).sort((a, b) => a.label.localeCompare(b.label)))
  const activeAssetTab = assetTabs.some((t) => t.key === assetTab) ? assetTab : "ALL"
  const visibleAssets = assignedAssets.filter((a) => activeAssetTab === "ALL" || categoryKeyOf(a) === activeAssetTab)

  function setUsageDraft(assetId, patch) {
    setUsageDrafts((prev) => ({ ...prev, [assetId]: { notUsing: false, actual: "", ...prev[assetId], ...patch } }))
  }

  function handleEditClick() {
    startEditing()
    setDetailsOpen(true)
    // The edit form lives in the Detailed Information card, which sits
    // below the fold on smaller screens — bring it into view.
    requestAnimationFrame(() => detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }

  // Attendance for the month being browsed — same formula as before: the
  // PRESENT+LATE share of recorded days. Data comes from
  // GET /employees/:id/activity, so any past month is exact (the profile
  // payload itself only carries the last 90 days).
  const now = new Date()
  // While a newly picked month loads, the previous month's data is still in
  // the cache — never show it under the new month's name.
  const monthReady = monthActivity?.month === viewMonth
  const monthData = monthReady ? monthActivity : null
  const monthAttendance = monthData?.attendanceRecords || []
  const presentCount = monthAttendance.filter((a) => a.status === "PRESENT").length
  const lateCount = monthAttendance.filter((a) => a.status === "LATE").length
  const absentCount = monthAttendance.filter((a) => a.status === "ABSENT").length
  const attendancePct = monthAttendance.length ? Math.round(((presentCount + lateCount) / monthAttendance.length) * 100) : 0
  const minMonth = employee.joiningDate ? dayKeyOf(employee.joiningDate).slice(0, 7) : null

  // Calendar for the browsed month (Monday first). Approved leave with no
  // attendance record still shows as leave.
  const recordByDay = new Map(monthAttendance.map((r) => [dayKeyOf(r.date), r]))
  const leaveDays = new Set()
  for (const leave of monthData?.leaves || []) {
    for (let d = new Date(`${dayKeyOf(leave.startDate)}T00:00:00Z`); d <= new Date(`${dayKeyOf(leave.endDate)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      leaveDays.add(d.toISOString().slice(0, 10))
    }
  }
  const [viewYear, viewMonthNumber] = viewMonth.split("-").map(Number)
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonthNumber, 0)).getUTCDate()
  const leadingBlanks = (new Date(Date.UTC(viewYear, viewMonthNumber - 1, 1)).getUTCDay() + 6) % 7
  const calendarDays = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${viewMonth}-${String(i + 1).padStart(2, "0")}`
    return { key, day: i + 1, status: recordByDay.get(key)?.status || (leaveDays.has(key) ? "LEAVE" : null), future: key > todayIso }
  })

  // The day shown in the check-in/out panel: the clicked day, else today
  // when browsing the current month.
  const activeDay = selectedDay || (viewMonth === currentMonth ? todayIso : null)
  const isTodayActive = activeDay === todayIso
  const activeRecord = activeDay ? (isTodayActive ? todayRecord || recordByDay.get(activeDay) : recordByDay.get(activeDay)) : null
  const activeOnLeave = activeRecord?.status === "LEAVE" || (activeDay && !activeRecord && leaveDays.has(activeDay))
  const quickMarkOn = canQuickMark && isTodayActive && !activeOnLeave
  const checkInAction = quickMarkOn && !activeRecord?.checkInAt ? () => quickMark("CHECK_IN") : null
  const checkOutAction = quickMarkOn && activeRecord?.checkInAt && !activeRecord?.checkOutAt ? () => quickMark("CHECK_OUT") : null

  // Month activity feed: check-ins/outs, absences, approved leave, asset
  // actions and raised tickets, newest first.
  const monthActivities = []
  for (const r of monthAttendance) {
    const statusNote = r.status === "LATE" ? "Late" : r.locationMode === "WFH" ? "Work from home" : r.status === "PRESENT" ? "On time" : ""
    if (r.checkInAt) monthActivities.push({ id: `${r.id}-in`, at: r.checkInAt, icon: LogIn, tone: r.status === "LATE" ? "yellow" : "green", title: "Checked in", note: `${formatTime(r.checkInAt)}${statusNote ? ` · ${statusNote}` : ""}` })
    if (r.checkOutAt) monthActivities.push({ id: `${r.id}-out`, at: r.checkOutAt, icon: LogOut, tone: "blue", title: "Checked out", note: formatTime(r.checkOutAt) })
    if (!r.checkInAt && r.status === "ABSENT") monthActivities.push({ id: `${r.id}-abs`, at: `${dayKeyOf(r.date)}T12:00:00Z`, icon: UserX, tone: "pink", title: "Absent", note: r.autoFlagged ? "Flagged — outside premises" : "Marked absent" })
    if (!r.checkInAt && r.status === "LEAVE") monthActivities.push({ id: `${r.id}-lv`, at: `${dayKeyOf(r.date)}T12:00:00Z`, icon: CalendarRange, tone: "blue", title: "On leave", note: "" })
  }
  for (const l of monthData?.leaves || []) {
    const range = dayKeyOf(l.startDate) === dayKeyOf(l.endDate) ? fmtDate(l.startDate) : `${fmtDate(l.startDate)} – ${fmtDate(l.endDate)}`
    monthActivities.push({ id: `leave-${l.id}`, at: `${dayKeyOf(l.startDate)}T12:00:00Z`, icon: CalendarRange, tone: "cyan", title: `${LEAVE_TYPE_LABEL[l.type] || "Paid"} leave${l.isHalfDay ? " (half day)" : ""}`, note: range })
  }
  for (const e of monthData?.lifecycleEvents || []) {
    monthActivities.push({ id: `ev-${e.id}`, at: e.occurredAt, icon: Activity, tone: "purple", title: e.asset?.name || "Asset", note: (e.type || "").replaceAll("_", " ").toLowerCase() })
  }
  for (const t of monthData?.tickets || []) {
    monthActivities.push({ id: `tk-${t.id}`, at: t.createdAt, icon: TicketIcon, tone: "orange", title: t.subject, note: `ticket raised · ${(t.status || "").replaceAll("_", " ").toLowerCase()}` })
  }
  monthActivities.sort((a, b) => new Date(b.at) - new Date(a.at))

  // Quick check-in/out from the profile — same calls and geofence rules as
  // My Attendance (GPS → nearest assigned site; the server decides
  // on-time/late/outside), minus the offline queue, which lives there.
  async function quickMark(type) {
    setMarkMessage(null)
    if (!navigator.onLine) {
      setMarkMessage({ tone: "error", text: "You're offline. Use My Attendance — it saves your check-in and syncs it later." })
      return
    }
    setMarking(type)
    try {
      let position
      try {
        position = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error("unsupported"))
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 })
        })
      } catch (err) {
        throw new Error(err?.code === 1
          ? "Location permission was denied. Allow location access and try again."
          : "We could not get your location. Try again with location services enabled.")
      }
      const { latitude, longitude, accuracy } = position.coords
      const nearest = nearestAssignedSite(assignedSites, latitude, longitude)
      const site = nearest?.site || assignedSites.find((s) => s.isPrimary) || assignedSites[0] || null
      const inside = nearest?.inside ?? false
      const clientEventId = `att-${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random()}`}`

      if (type === "CHECK_IN") {
        const { data } = await api.post("/attendance/self/mark", {
          status: "PRESENT",
          latitude,
          longitude,
          gpsAccuracy: accuracy,
          siteId: site?.id || null,
          locationMode: "OFFICE",
          clientEventId,
        })
        setMarkMessage(data?.outsideSite
          ? { tone: "info", text: data.message || "You checked in outside the office premises. It was recorded as Late with your location; HR will review it." }
          : { tone: "info", text: "Checked in." })
      } else {
        if (site && site.geofenceMode === "STRICT" && !inside) {
          throw new Error("You are outside your assigned site. Move inside the site area and try again.")
        }
        const recordedAt = new Date()
        const { data } = await api.post("/attendance/self/offline-sync", {
          events: [{
            type: "CHECK_OUT",
            localRecordedAt: recordedAt.toISOString(),
            localDate: dateKeyIn(recordedAt, timeZone),
            timezone: timeZone || "UTC",
            locationMode: todayRecord?.locationMode || "OFFICE",
            latitude,
            longitude,
            gpsAccuracy: accuracy,
            distanceMeters: nearest?.distance != null ? Math.round(nearest.distance) : null,
            siteId: site?.id || null,
            siteName: site?.name || "Unassigned / no site",
            outsideSite: false,
            deviceId: getAttendanceDeviceId(),
            networkType: navigator.connection?.effectiveType || "online",
            clientEventId,
          }],
        })
        if (data?.rejected?.length) throw new Error(data.rejected[0].error || "Check-out was not accepted.")
        setMarkMessage({ tone: "info", text: "Checked out." })
      }
      queryClient.invalidateQueries({ queryKey: ["employee", id] })
      queryClient.invalidateQueries({ queryKey: ["employee-activity", id] })
      queryClient.invalidateQueries({ queryKey: ["attendance-self"] })
    } catch (err) {
      setMarkMessage({ tone: "error", text: err?.response?.data?.error || err.message || "Could not mark attendance." })
    } finally {
      setMarking(null)
    }
  }
  const attendanceLegend = [
    { key: "present", label: "Present", count: presentCount, dot: "bg-emerald-500" },
    { key: "absent", label: "Absent", count: absentCount, dot: "bg-rose-500" },
    { key: "late", label: "Late", count: lateCount, dot: "bg-amber-400" },
  ]

  // Leave balance — same day counting as before, split by leave type.
  const year = now.getFullYear()
  const leaveUsed = { CASUAL: 0, SICK: 0, UNPAID: 0 }
  for (const l of employee.leaveApplications || []) {
    if (new Date(l.startDate).getFullYear() !== year) continue
    const days = Math.max(1, Math.round((new Date(l.endDate) - new Date(l.startDate)) / 86400000) + 1)
    leaveUsed[l.type || "CASUAL"] = (leaveUsed[l.type || "CASUAL"] || 0) + days
  }
  const paidAllowance = Number(employee.organization?.casualLeaveAllowance || 0)
  const sickAllowance = Number(employee.organization?.sickLeaveAllowance || 0)
  const paidLeft = Math.max(0, paidAllowance - leaveUsed.CASUAL)
  const sickLeft = Math.max(0, sickAllowance - leaveUsed.SICK)
  const totalLeaveLeft = paidLeft + sickLeft
  const totalLeaveUsed = leaveUsed.CASUAL + leaveUsed.SICK + leaveUsed.UNPAID
  const leaveBreakdown = [
    { key: "paid", label: "Paid", value: paidLeft, note: `left of ${paidAllowance}`, dot: "bg-emerald-500" },
    { key: "sick", label: "Sick", value: sickLeft, note: `left of ${sickAllowance}`, dot: "bg-sky-500" },
    { key: "unpaid", label: "Unpaid", value: leaveUsed.UNPAID, note: "taken", dot: "bg-amber-400" },
  ]

  const projectMemberships = employee.projectMemberships || []
  const projectBreakdown = [
    { key: "NOT_STARTED", label: "Not started", dot: "bg-gray-400" },
    { key: "IN_PROGRESS", label: "In progress", dot: "bg-sky-500" },
    { key: "COMPLETED", label: "Completed", dot: "bg-emerald-500" },
  ].map((s) => ({ ...s, value: projectMemberships.filter((m) => (m.project?.status || "NOT_STARTED") === s.key).length }))

  // Payroll rows open the payroll page: your own payslips when it's your
  // profile, otherwise the Payroll page for roles that can reach it.
  const payrollLink = isSelf ? "/payroll/me" : canAccessPayroll(user?.role) ? "/payroll" : null

  const organizationName = employee.organization?.name || organization?.name
  // Core fields always show (with "—" when empty) so the card keeps a steady
  // shape; the optional ones only appear when set. Personal email/address
  // follow the same lens as the Detailed Information card.
  const heroMeta = [
    { key: "title", icon: Briefcase, label: "Role / Job title", value: employee.designation || ROLE_LABELS[employee.role] || employee.role, always: true },
    { key: "email", icon: Mail, label: "Company email", value: employee.email, always: true },
    { key: "personalEmail", icon: AtSign, label: "Personal email", value: employee.personalEmail, always: true, hidden: isIT },
    { key: "phone", icon: Phone, label: "Phone", value: employee.phone, always: true },
    { key: "department", icon: Layers, label: "Department", value: employee.department?.name, always: true },
    { key: "manager", icon: ManagerIcon, label: "Reporting manager", value: employee.manager?.name, always: true },
    { key: "address", icon: MapPin, label: "Address", value: employee.address, always: true, hidden: !showPersonalDetails },
    { key: "org", icon: Building2, label: "Company", value: organizationName },
    { key: "joined", icon: Calendar, label: "Joined", value: fmtDate(employee.joiningDate) },
    { key: "shift", icon: Clock3, label: "Shift", value: employee.shiftStart || employee.shiftEnd ? `${formatClock(employee.shiftStart) || "—"} - ${formatClock(employee.shiftEnd) || "—"}` : null },
  ].filter((item) => !item.hidden && (item.always || item.value))

  const iconButton = "flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"

  return (
    <div>
      <PageHeader
        title="Employee Profile"
        subtitle="Personal information, assigned assets and activity."
        backTo={canManageAssets || hasModuleAccess(user?.role, "employees") ? "/employees" : "/"}
      />
      {removeEmployee.isError && (
        <div className="mb-4 rounded-2xl bg-chip-pink-bg px-3.5 py-2.5 text-sm text-chip-pink-fg">
          {removeEmployee.error?.response?.data?.error || "Could not remove employee"}
        </div>
      )}
      {resetResult && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-chip-blue-bg px-3.5 py-2.5 text-sm text-chip-blue-fg">
          <span>
            Password reset temporary password: <span className="font-mono font-semibold">{resetResult}</span>. Share it with {employee.name} so they can log in and change it.
          </span>
          <button
            onClick={() => navigator.clipboard.writeText(resetResult)}
            className="shrink-0 rounded-full bg-white/60 px-3 py-1 text-xs font-semibold hover:bg-white"
          >
            Copy
          </button>
        </div>
      )}

      {/* Row 1 — profile hero + attendance summary */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className={`card min-w-0 p-5 sm:p-6 ${isIT ? "lg:col-span-3" : "lg:col-span-2"}`}>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <ProfilePhoto
              employeeId={employee.id}
              name={employee.name}
              src={employee.photoUrl}
              size="2xl"
              canEdit={canChangePhoto}
              className="self-center rounded-full shadow-card ring-4 ring-surface-2 sm:self-start"
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-center sm:text-left">
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    <h2 className="min-w-0 break-words text-xl font-bold text-ink sm:text-2xl" style={{ letterSpacing: "-0.02em" }}>
                      {employee.name}
                    </h2>
                    <StatusBadge type="employee" status={employee.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {employee.designation || employee.skill || ROLE_LABELS[employee.role] || employee.role}
                    {employee.department?.name ? ` · ${employee.department.name}` : ""}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
                  {canEdit && !editing && (
                    <button onClick={handleEditClick} className="pill-secondary flex h-9 items-center gap-1.5 px-3.5 text-xs">
                      <Pencil size={13} /> Edit profile
                    </button>
                  )}
                  {employee.email && (
                    <a href={`mailto:${employee.email}`} className={iconButton} aria-label="Email" title="Email">
                      <Mail size={15} />
                    </a>
                  )}
                  {employee.phone && (
                    <a href={`tel:${employee.phone}`} className={iconButton} aria-label="Call" title="Call">
                      <Phone size={15} />
                    </a>
                  )}
                  {canResetPassword && (
                    <button onClick={handleResetPassword} disabled={resetPassword.isPending} className={iconButton} aria-label="Reset password" title="Reset password">
                      <KeyRound size={15} />
                    </button>
                  )}
                  {canRemoveEmployee && (
                    <button
                      onClick={handleRemoveEmployee}
                      disabled={removeEmployee.isPending}
                      className={`${iconButton} text-danger hover:bg-chip-pink-bg`}
                      aria-label="Remove employee"
                      title={removeEmployee.isPending ? "Removing…" : "Remove employee"}
                    >
                      <UserX size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                <StatusPill tone="blue" icon={ShieldCheck}>{ROLE_LABELS[employee.role] || employee.role}</StatusPill>
                {level && <StatusPill tone={levelTone} icon={BadgeCheck}>{LEVEL_LABEL[level]}</StatusPill>}
                {!isIT && (
                  <StatusPill tone="slate" icon={MapPin}>{WORK_LOCATION_LABEL[employee.workLocationType] || "Office"}</StatusPill>
                )}
              </div>

              {heroMeta.length > 0 && (
                <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-3.5 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-3">
                  {heroMeta.map(({ key, icon: Icon, label, value }) => (
                    <div key={key} className="flex min-w-0 items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                        <Icon size={13} />
                      </span>
                      <div className="min-w-0">
                        <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-2">{label}</dt>
                        <dd className={`truncate text-sm font-medium ${value ? "text-ink" : "text-muted-2"}`} title={typeof value === "string" ? value : undefined}>{value || "—"}</dd>
                      </div>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        </section>

        {!isIT && (
          <section className="card flex min-w-0 flex-col p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="section-title">Leave Balance</h3>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">{year}</span>
            </div>
            <SummarySplit
              total={totalLeaveLeft}
              totalLabel="Total leaves left"
              totalNote={`${totalLeaveUsed} ${totalLeaveUsed === 1 ? "day" : "days"} used this year`}
              items={leaveBreakdown}
            />
          </section>
        )}
      </div>

      {isIT && (
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          {[
            { label: "Assigned assets", value: assignedAssets.length, hint: "Current assignments" },
            { label: "Laptops", value: laptopCount, hint: "Assigned laptop devices" },
            { label: "Accessories", value: accessoryCount, hint: "Monitors, phones and accessories" },
          ].map((stat) => (
            <div key={stat.label} className="card p-4">
              <p className="text-xs text-muted">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{stat.value}</p>
              <p className="text-[11px] text-muted">{stat.hint}</p>
            </div>
          ))}
        </section>
      )}

      {/* Row 2 — main content + details sidebar */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`min-w-0 space-y-5 ${isIT ? "lg:col-span-3" : "lg:col-span-2"}`}>
          {!isIT && (
            <section className="card p-5">
              <div className="grid gap-5 md:grid-cols-2 md:gap-6">
                {/* Browsed month */}
                <div className={`min-w-0 transition-opacity ${loadingMonth ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="section-title">Attendance</h3>
                      <p className="mt-0.5 text-xs text-muted">
                        {monthReady ? `${monthAttendance.length} ${monthAttendance.length === 1 ? "day" : "days"} recorded` : "Loading…"}
                      </p>
                    </div>
                    <p className="shrink-0 text-3xl font-bold tabular-nums text-ink" style={{ letterSpacing: "-0.03em" }}>
                      {monthReady ? `${attendancePct}%` : "…"}
                    </p>
                  </div>
                  <div className="mt-3">
                    <MonthNav monthKey={viewMonth} onChange={setViewMonth} minMonth={minMonth} maxMonth={currentMonth} />
                  </div>

                  <div className="mt-4 flex h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                    {monthAttendance.length > 0 && attendanceLegend.map((item) => (
                      <span key={item.key} className={item.dot} style={{ width: `${(item.count / monthAttendance.length) * 100}%` }} />
                    ))}
                  </div>

                  <ul className="mt-4 grid grid-cols-3 gap-2">
                    {attendanceLegend.map((item) => (
                      <li key={item.key} className="min-w-0 rounded-2xl bg-surface-2 px-3 py-2.5">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${item.dot}`} />
                          <span className="truncate">{item.label}</span>
                        </p>
                        <p className="mt-1 text-lg font-bold tabular-nums text-ink">{monthReady ? item.count : "…"}</p>
                      </li>
                    ))}
                  </ul>

                  {/* Day calendar — click a past day to see its check-in/out. */}
                  <div className="mt-4">
                    <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-muted-2">
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}
                    </div>
                    <div className="mt-1 grid grid-cols-7 gap-1">
                      {Array.from({ length: leadingBlanks }, (_, i) => <span key={`b${i}`} />)}
                      {calendarDays.map((d) => {
                        const selected = d.key === activeDay
                        return (
                          <button
                            key={d.key}
                            type="button"
                            disabled={d.future}
                            onClick={() => setSelectedDay(d.key)}
                            title={d.status ? `${dayTitle(d.key)} · ${d.status.toLowerCase()}` : dayTitle(d.key)}
                            className={`flex h-7 items-center justify-center rounded-lg text-[11px] font-semibold tabular-nums transition-colors disabled:cursor-default disabled:opacity-35 ${
                              d.status ? DAY_TONE[d.status] : "text-muted hover:bg-surface-2"
                            } ${selected ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : ""} ${d.key === todayIso && !selected ? "outline outline-1 outline-border-strong" : ""}`}
                          >
                            {d.day}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-2">
                      <span className="h-2 w-2 rounded-full bg-chip-blue-bg" /> Leave
                    </p>
                  </div>
                </div>

                {/* Selected day (today by default) */}
                <div className="flex min-w-0 flex-col border-t border-border pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-ink">{isTodayActive ? "Today's shift" : activeDay ? dayTitle(activeDay) : "Pick a day"}</p>
                    {activeRecord?.status === "LATE" && <StatusPill tone="yellow">LATE</StatusPill>}
                    {activeRecord?.status === "ABSENT" && <StatusPill tone="pink">ABSENT</StatusPill>}
                    {activeOnLeave && <StatusPill tone="blue">LEAVE</StatusPill>}
                    {selectedDay && viewMonth === currentMonth && !isTodayActive && (
                      <button type="button" onClick={() => setSelectedDay(null)} className="ml-auto text-[11px] font-semibold text-accent hover:underline">
                        Back to today
                      </button>
                    )}
                  </div>
                  {activeDay ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          { key: "CHECK_IN", label: "Check in", icon: LogIn, value: activeRecord?.checkInAt, action: checkInAction },
                          { key: "CHECK_OUT", label: "Check out", icon: LogOut, value: activeRecord?.checkOutAt, action: checkOutAction },
                        ].map(({ key, label, icon: Icon, value, action }) => {
                          const busy = marking === key
                          const body = (
                            <>
                              <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
                                <Icon size={12} /> {label}
                              </span>
                              <span className={`mt-1 block text-lg font-bold tabular-nums ${value ? "text-ink" : action ? "text-accent" : "text-muted-2"}`}>
                                {value ? formatTime(value) : busy ? "Locating…" : action ? "Tap to mark" : "—"}
                              </span>
                            </>
                          )
                          return action ? (
                            <button
                              key={key}
                              type="button"
                              onClick={action}
                              disabled={!!marking}
                              className="min-w-0 rounded-2xl border border-dashed border-accent bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-border disabled:cursor-wait disabled:opacity-70"
                            >
                              {body}
                            </button>
                          ) : (
                            <div key={key} className="min-w-0 rounded-2xl border border-transparent bg-surface-2 px-3 py-2.5">{body}</div>
                          )
                        })}
                      </div>
                      {markMessage && isTodayActive && (
                        <p className={`mt-2 text-xs ${markMessage.tone === "error" ? "text-danger" : "text-chip-green-fg"}`}>
                          {markMessage.text}
                          {markMessage.tone === "error" && <> <Link to="/attendance/me" className="font-semibold underline">Open My Attendance</Link></>}
                        </p>
                      )}
                      {activeRecord?.checkInAt ? (
                        <WorkingTimeProgress
                          workingMinutes={activeRecord.workingMinutes}
                          checkInAt={activeRecord.checkInAt}
                          checkOutAt={activeRecord.checkOutAt}
                          expectedMinutes={Number(organization?.workingHoursPerDay || 8) * 60}
                          date={activeRecord.date}
                          className="mt-3 max-w-none"
                        />
                      ) : (
                        <p className="mt-3 text-xs text-muted">
                          {activeOnLeave ? "On approved leave." : isTodayActive ? "No attendance recorded today yet." : "No attendance recorded for this day."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-muted">Click a day in the calendar to see its check-in and check-out.</p>
                  )}
                  <Link
                    to={`/employees/${id}/attendance`}
                    className="mt-auto inline-flex items-center gap-1.5 pt-4 text-xs font-semibold text-accent hover:underline"
                  >
                    <CalendarRange size={13} /> View attendance history <ChevronRight size={13} />
                  </Link>
                </div>
              </div>
            </section>
          )}

          {!isIT && employee.payrollRecords !== undefined && (
            <section className="card p-5">
              <SectionHeader
                title="Recent payroll"
                action={payrollLink && (employee.payrollRecords || []).length > 0 && (
                  <Link to={payrollLink} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                    View all <ChevronRight size={13} />
                  </Link>
                )}
              />
              {(employee.payrollRecords || []).length > 0 ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {(employee.payrollRecords || []).slice(0, 5).map((p) => {
                    const row = (
                      <>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{p.month}/{p.year}</p>
                          <p className="text-xs text-muted">{(p.status || "").replaceAll("_", " ")}</p>
                        </div>
                        <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-ink">
                          PKR {Number(p.netPay || 0).toLocaleString()}
                          {payrollLink && <ChevronRight size={14} className="text-muted" />}
                        </span>
                      </>
                    )
                    const rowClass = "flex items-center justify-between gap-2 rounded-2xl bg-surface-2 p-3"
                    return (
                      <li key={p.id}>
                        {payrollLink ? (
                          <Link to={payrollLink} className={`${rowClass} transition-colors hover:bg-border`}>{row}</Link>
                        ) : (
                          <div className={rowClass}>{row}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-sm text-muted">No payroll records.</p>
              )}
            </section>
          )}

          {/* Assigned Assets */}
          {showAssets ? (
            <section className="card p-5">
              <SectionHeader
                title={`Assigned Assets${assignedAssets.length ? ` (${assignedAssets.length})` : ""}`}
                action={
                  canManageAssets && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowAssignForm((v) => !v)}
                        className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      >
                        {showAssignForm ? <X size={12} /> : <Plus size={12} />}
                        {showAssignForm ? "Cancel" : "Assign"}
                      </button>
                      <button
                        onClick={() => setShowAddAssetForm((v) => !v)}
                        className="pill-accent flex items-center gap-1.5 px-3 py-1.5 text-xs"
                      >
                        {showAddAssetForm ? <X size={12} /> : <Plus size={12} />}
                        {showAddAssetForm ? "Cancel" : "Add asset"}
                      </button>
                    </div>
                  )
                }
              />

              {showAddAssetForm && (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (newAsset.name.trim() && newAsset.serialNumber.trim()) addAndAssignAsset.mutate() }}
                  className="mb-4 grid grid-cols-1 gap-2 rounded-2xl border border-border bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <TextField label="Asset name" value={newAsset.name} onChange={(e) => setNewAsset((v) => ({ ...v, name: e.target.value }))} required />
                  <TextField label="Category" value={newAsset.category} onChange={(e) => setNewAsset((v) => ({ ...v, category: e.target.value }))} placeholder="Laptop, Monitor, Phone…" />
                  <TextField label="Serial number" value={newAsset.serialNumber} onChange={(e) => setNewAsset((v) => ({ ...v, serialNumber: e.target.value }))} required />
                  <TextField label="CPU" value={newAsset.cpu} onChange={(e) => setNewAsset((v) => ({ ...v, cpu: e.target.value }))} />
                  <TextField label="RAM" value={newAsset.ram} onChange={(e) => setNewAsset((v) => ({ ...v, ram: e.target.value }))} />
                  <TextField label="Storage" value={newAsset.storage} onChange={(e) => setNewAsset((v) => ({ ...v, storage: e.target.value }))} />
                  <TextField label="Purchase date" type="date" value={newAsset.purchaseDate} onChange={(e) => setNewAsset((v) => ({ ...v, purchaseDate: e.target.value }))} />
                  <TextField label="Warranty end" type="date" value={newAsset.warrantyEnd} onChange={(e) => setNewAsset((v) => ({ ...v, warrantyEnd: e.target.value }))} />
                  <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                    <button type="submit" disabled={addAndAssignAsset.isPending} className="pill-accent px-4 py-2 text-xs disabled:opacity-60">
                      {addAndAssignAsset.isPending ? "Saving…" : "Add & assign asset"}
                    </button>
                  </div>
                </form>
              )}

              {showAssignForm && (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (selectedAssetId) assignAsset.mutate() }}
                  className="mb-4 flex gap-2"
                >
                  <select
                    value={selectedAssetId}
                    onChange={(e) => setSelectedAssetId(e.target.value)}
                    required
                    className="field min-w-0 flex-1"
                  >
                    <option value="">Select an available asset…</option>
                    {(availableAssets || []).map((a) => (
                      <option key={a.id} value={a.id}>{a.name} — {a.serialNumber}</option>
                    ))}
                  </select>
                  <button type="submit" disabled={assignAsset.isPending} className="pill-accent px-4 text-xs">
                    Assign
                  </button>
                </form>
              )}

              {/* One tab per assigned category */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                {assetTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setAssetTab(tab.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      activeAssetTab === tab.key ? "pill-accent px-3 py-1.5" : "bg-surface-2 text-muted hover:text-ink"
                    }`}
                  >
                    {tab.key !== "ALL" && (tab.key.includes("laptop") ? <Laptop size={11} /> : <PackageSearch size={11} />)}
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {visibleAssets.length > 0 ? (
                <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
                  {visibleAssets.map((asset) => {
                    const draft = usageDrafts[asset.id] || { notUsing: false, actual: "" }
                    const submitted = usageSubmitted[asset.id]
                    return (
                      <li key={asset.id} className="rounded-2xl border border-border px-3 py-2.5 transition-colors hover:bg-surface-2">
                        <div className="flex items-center gap-3">
                          <IconChip icon={assetTabOf(asset) === "LAPTOP" ? Laptop : Boxes} tone="blue" size="sm" />
                          <div className="min-w-0 flex-1">
                            <Link to={`/inventory/${asset.id}`} className="block truncate text-sm font-semibold text-ink hover:text-accent">
                              {asset.name}
                            </Link>
                            <p className="truncate text-[11px] text-muted">
                              <button type="button" onClick={() => setAssetTab(categoryKeyOf(asset))} className="font-medium hover:text-accent hover:underline" title={`Show only ${categoryLabelOf(asset)}`}>
                                {categoryLabelOf(asset)}
                              </button>
                              {" · "}<span className="font-mono">{asset.serialNumber}</span>
                              {asset.warrantyEnd ? ` · Warranty until ${fmtDate(asset.warrantyEnd)}` : ""}
                            </p>
                          </div>
                          {asset.status && (
                            <StatusPill tone={ASSET_STATUS_TONE[asset.status] || "slate"} className="hidden shrink-0 sm:inline-flex">
                              {asset.status.toLowerCase()}
                            </StatusPill>
                          )}
                          {canManageAssets && (
                            <button
                              onClick={() => removeAsset.mutate(asset.id)}
                              disabled={removeAsset.isPending}
                              className="shrink-0 text-xs font-semibold text-danger hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>

                        {/* Self-service usage confirmation — routes a
                            discrepancy to IT/management as a ticket. */}
                        {isSelf && (
                          <div className="ml-12 mt-1.5">
                            {submitted ? (
                              <p className="flex items-center gap-1 text-[11px] font-medium text-chip-green-fg">
                                <Check size={11} /> Reported to IT — they'll follow up.
                              </p>
                            ) : (
                              <>
                                <label className="flex items-center gap-1.5 text-[11px] text-muted">
                                  <input
                                    type="checkbox"
                                    checked={!draft.notUsing}
                                    onChange={(e) => setUsageDraft(asset.id, { notUsing: !e.target.checked })}
                                    className="h-3.5 w-3.5 rounded border-border-strong"
                                  />
                                  I'm currently using this
                                </label>
                                {draft.notUsing && (
                                  <form
                                    onSubmit={(e) => {
                                      e.preventDefault()
                                      if (draft.actual.trim()) reportUsage.mutate({ asset, actual: draft.actual.trim() })
                                    }}
                                    className="mt-1.5 flex gap-1.5"
                                  >
                                    <input
                                      value={draft.actual}
                                      onChange={(e) => setUsageDraft(asset.id, { actual: e.target.value })}
                                      placeholder="What are you actually using?"
                                      className="field min-w-0 flex-1 py-1.5 text-xs"
                                      required
                                    />
                                    <button
                                      type="submit"
                                      disabled={reportUsage.isPending}
                                      className="pill-accent flex items-center gap-1 px-3 py-1.5 text-[11px] disabled:opacity-60"
                                    >
                                      <Send size={10} /> Submit
                                    </button>
                                  </form>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <EmptyState icon={Boxes} title="No assets here" description="Nothing assigned in this category yet." />
              )}
            </section>
          ) : (
            <section className="card p-5">
              <SectionHeader title="Assigned Assets" />
              <p className="text-sm text-muted">Asset details aren't part of your department's view of this profile.</p>
            </section>
          )}

          {isSelf && (
            <section className="card p-5">
              <SectionHeader
                title="My Asset Requests"
                action={
                  <button
                    onClick={() => setShowRequestForm((v) => !v)}
                    className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    {showRequestForm ? <X size={12} /> : <Plus size={12} />}
                    {showRequestForm ? "Cancel" : "Request"}
                  </button>
                }
              />

              {showRequestForm && (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (requestCategory && requestReason.trim()) createRequest.mutate() }}
                  className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  <TextField label="What do you need?" value={requestCategory} onChange={(e) => setRequestCategory(e.target.value)} placeholder="e.g. Monitor" required />
                  <TextField label="Reason" value={requestReason} onChange={(e) => setRequestReason(e.target.value)} placeholder="Why you need it" required />
                  <button type="submit" disabled={createRequest.isPending} className="pill-accent px-4 py-2.5 text-xs sm:col-span-2">
                    {createRequest.isPending ? "Submitting…" : "Submit request"}
                  </button>
                </form>
              )}

              {(myRequests || []).length > 0 ? (
                <ul className="space-y-2">
                  {(myRequests || []).map((r) => (
                    <li key={r.id} className="rounded-2xl border border-border px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-ink">{r.category}</p>
                        <StatusPill tone={REQUEST_TONE[r.status]}>{r.status}</StatusPill>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">{r.reason}</p>
                      {r.fulfilledAsset && (
                        <p className="mt-1 text-xs font-medium text-chip-green-fg">
                          Fulfilled: {r.fulfilledAsset.name} ({r.fulfilledAsset.serialNumber})
                        </p>
                      )}
                      {r.status === "PENDING" && (
                        <button
                          onClick={() => cancelRequest.mutate(r.id)}
                          disabled={cancelRequest.isPending}
                          className="mt-1.5 text-xs font-semibold text-danger hover:underline"
                        >
                          Cancel request
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No requests yet" description="Need something? Submit a request above." />
              )}
            </section>
          )}

        </div>

        {!isIT && (
          <div className="min-w-0 space-y-5">
            <section className="card p-5">
              <h3 className="section-title">Projects</h3>
              <SummarySplit
                total={projectMemberships.length}
                totalLabel="Total projects"
                items={projectBreakdown}
              />
              {projectMemberships.length > 0 ? (
                <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
                  {projectMemberships.slice(0, 4).map((m) => {
                    const status = PROJECT_STATUS[m.project?.status] || PROJECT_STATUS.NOT_STARTED
                    const deadline = m.project?.deadline ? String(m.project.deadline).slice(0, 10) : null
                    const overdue = deadline && deadline < todayIso && m.project?.status !== "COMPLETED"
                    return (
                      <li key={m.id} className="flex items-center justify-between gap-2 rounded-xl px-1 py-1">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{m.project?.name}</p>
                          {deadline && (
                            <p className={`text-[11px] ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
                              {overdue ? "Overdue" : "Due"} {fmtDate(m.project.deadline)}
                            </p>
                          )}
                        </div>
                        <StatusPill tone={status.tone} className="shrink-0">{status.label}</StatusPill>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-4 border-t border-border pt-3 text-xs text-muted">This employee isn't on any projects yet.</p>
              )}
            </section>

              <section className="card min-w-0 p-5">
                <SectionHeader title="Support History" />
                {(employee.tickets || []).length > 0 ? (
                  <ul className="max-h-80 space-y-1 overflow-y-auto">
                    {(employee.tickets || []).map((ticket) => (
                      <li key={ticket.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                        <IconChip icon={TicketIcon} tone="orange" size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{ticket.subject}</p>
                          <p className="text-xs text-muted">
                            {(ticket.status || "").replaceAll("_", " ").toLowerCase()} · {(ticket.priority || "").toLowerCase()} priority
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={TicketIcon} title="No tickets" description="This employee hasn't raised any support requests." />
                )}
              </section>

              <section className="card min-w-0 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="section-title">Activity</h3>
                  <MonthNav monthKey={viewMonth} onChange={setViewMonth} minMonth={minMonth} maxMonth={currentMonth} />
                </div>
                {monthActivities.length > 0 ? (
                  <ul className={`max-h-96 space-y-1 overflow-y-auto transition-opacity ${loadingMonth ? "opacity-60" : ""}`}>
                    {monthActivities.map((item) => (
                      <li key={item.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                        <IconChip icon={item.icon} tone={item.tone} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                          {item.note && <p className="truncate text-xs text-muted">{item.note}</p>}
                        </div>
                        <span className="shrink-0 text-[11px] text-muted">
                          {new Date(item.at).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: timeZone || undefined })}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={Activity} title={monthReady ? "No activity this month" : "Loading…"} />
                )}
              </section>
          </div>
        )}
      </div>

      {/* Detailed Information — full width at the end of the page, groups
          side by side. Collapsible: the key fields are already in the
          profile card, so the full list stays folded until asked for; the
          edit form always shows while editing. */}
      {!isIT && (
            <section ref={detailsRef} className="card mt-5 scroll-mt-4 p-5 sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => !editing && setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen || editing}
                  aria-controls="employee-detailed-information"
                  className="-mx-1 flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-1 py-1 text-left"
                >
                  <h3 className="section-title">Detailed Information</h3>
                  {!editing && (
                    <ChevronDown size={18} className={`shrink-0 text-muted transition-transform duration-200 ${detailsOpen ? "rotate-180" : ""}`} />
                  )}
                </button>
                {editing && (
                  <button onClick={() => setEditing(false)} className="pill-secondary flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs">
                    <X size={12} /> Cancel
                  </button>
                )}
              </div>

              {(detailsOpen || editing) && <div id="employee-detailed-information" className="mt-4">
              {editing ? (
                <form onSubmit={handleSaveEdit} className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                  {/* Each field appears exactly once, grouped the same way as the
                      read-only view below. */}
                  <FormGroup title="Contact">
                    {canEditFully && <TextField label="Full name" value={editForm.name} onChange={setField("name")} required />}
                    <TextField label="Company Email" type="email" value={editForm.email} onChange={setField("email")} required />
                    <TextField label="Phone" value={editForm.phone} onChange={setField("phone")} />
                    {canEditFully && <TextField label="Personal Email" type="email" value={editForm.personalEmail} onChange={setField("personalEmail")} />}
                  </FormGroup>
                  {canEditFully && (
                    <>
                      <FormGroup title="Employment">
                        <TextField label="Designation / Title" value={editForm.designation} onChange={setField("designation")} placeholder="e.g. Senior Backend Engineer" />
                        <SelectField label="Department" value={editForm.departmentId} onChange={setField("departmentId")}>
                          <option value="">None</option>
                          {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </SelectField>
                        <SelectField label="Reporting Manager" value={editForm.managerId} onChange={setField("managerId")}>
                          <option value="">None</option>
                          {(managerOptions || []).filter((manager) => manager.id !== employee.id).map((manager) => (
                            <option key={manager.id} value={manager.id}>{manager.name} — {ROLE_LABELS[manager.role] || manager.role}</option>
                          ))}
                        </SelectField>
                        <SelectField label="Role" value={editForm.role} disabled={!canChangeRole} onChange={setField("role")}>
                          {Object.entries(ROLE_LABELS)
                            .filter(([value]) => ["ADMIN", "CEO", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "IT_MANAGER", "SITE_ADMIN", "EMPLOYEE"].includes(value))
                            // HR can't hand out the owner-tier roles.
                            .filter(([value]) => canChangeRoleAndStatus || !["ADMIN", "CEO"].includes(value) || value === editForm.role)
                            .filter(([value]) => value !== "CEO" || employee.role === "CEO" || (managerOptions || []).filter((m) => m.role === "CEO").length < 3)
                            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </SelectField>
                        <SelectField label="Status" value={editForm.status} disabled={employee.role === "CEO" && user?.role !== "CEO"} onChange={setField("status")}>
                          <option value="ACTIVE">Active</option>
                          <option value="ON_LEAVE">On Leave</option>
                          <option value="LEFT_COMPANY">Left Company</option>
                        </SelectField>
                        <SelectField label="Employee type" value={editForm.workLocationType} onChange={setField("workLocationType")}>
                          <option value="OFFICE">Office (attendance geofence applies)</option>
                          <option value="FIELD">Field / Remote (exempt from geofence)</option>
                        </SelectField>
                        <SelectField label="Level" value={editForm.seniorityLevel} onChange={setField("seniorityLevel")}>
                          <option value="">None</option>
                          {Object.entries(LEVEL_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </SelectField>
                        <TextField label="Skill" value={editForm.skill} onChange={setField("skill")} />
                        <TextField label="Joining date" type="date" value={editForm.joiningDate} onChange={setField("joiningDate")} hint="Joined the company" />
                        <TextField label="Start date" type="date" value={editForm.startDate} onChange={setField("startDate")} hint="Started the assigned operation / campaign / position" />
                        <SelectField
                          label="Employment status"
                          value={editForm.employmentStatus}
                          disabled={!canEditEmploymentStatus}
                          onChange={(e) => setEditForm((f) => ({ ...f, employmentStatus: e.target.value, permanentDate: e.target.value === "PROBATION" ? "" : f.permanentDate }))}
                        >
                          <option value="PROBATION">Probation</option>
                          <option value="PERMANENT">Permanent</option>
                        </SelectField>
                        {editForm.employmentStatus === "PERMANENT" && (
                          <TextField label="Permanent from" type="date" value={editForm.permanentDate} disabled={!canEditEmploymentStatus} onChange={setField("permanentDate")} hint="Leave schedule starts this month (blank = today)" />
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <TextField label="Shift Start" type="time" value={editForm.shiftStart} hint={formatClock(editForm.shiftStart)} onChange={setField("shiftStart")} />
                          <TextField label="Shift End" type="time" value={editForm.shiftEnd} hint={formatClock(editForm.shiftEnd)} onChange={setField("shiftEnd")} />
                        </div>
                      </FormGroup>
                      <FormGroup title="Personal / Identification">
                        <TextField label="Father Name" value={editForm.fatherName} onChange={setField("fatherName")} />
                        <TextField label="CNIC" value={editForm.cnic} onChange={setField("cnic")} placeholder="XXXXX-XXXXXXX-X" hint="Stored encrypted" />
                        <TextField label="Passport Number" value={editForm.passportNumber} onChange={setField("passportNumber")} hint="Stored encrypted" />
                        <TextField label="Civil Number" value={editForm.civilNumber} onChange={setField("civilNumber")} hint="Stored encrypted" />
                        <TextField label="Nationality" value={editForm.nationality} onChange={setField("nationality")} placeholder="e.g. Pakistani" />
                        <TextField label="Date of birth" type="date" value={editForm.dob} onChange={setField("dob")} />
                        <TextField label="Location / Residence" value={editForm.address} onChange={setField("address")} />
                      </FormGroup>
                      <FormGroup title="Emergency contact">
                        <TextField label="Contact name" value={editForm.emergencyContactName} onChange={setField("emergencyContactName")} />
                        <TextField label="Relationship" value={editForm.emergencyContactRelationship} onChange={setField("emergencyContactRelationship")} placeholder="e.g. Brother, Spouse" />
                        <TextField label="Phone" value={editForm.emergencyContactPhone} onChange={setField("emergencyContactPhone")} />
                        <TextField label="Alternate phone" value={editForm.emergencyContactAltPhone} onChange={setField("emergencyContactAltPhone")} />
                        <TextField label="Address" value={editForm.emergencyContactAddress} onChange={setField("emergencyContactAddress")} />
                        <TextField label="Other information" value={editForm.emergencyContactNotes} onChange={setField("emergencyContactNotes")} placeholder="e.g. Call after 6 PM" />
                      </FormGroup>
                      <FormGroup title="Recruitment & education">
                        <TextField label="Agent Name" value={editForm.agentName} onChange={setField("agentName")} placeholder="Recruitment agent, if any" />
                        <TextField label="Education" value={editForm.education} onChange={setField("education")} placeholder="e.g. BS Computer Science" />
                        <TextField label="University" value={editForm.currentUniversity} onChange={setField("currentUniversity")} />
                        <TextField label="LinkedIn URL" value={editForm.linkedinUrl} onChange={setField("linkedinUrl")} placeholder="https://www.linkedin.com/in/..." />
                      </FormGroup>
                      <FormGroup title="Payroll & bank">
                        <TextField
                          label="Base Salary (PKR / month)"
                          type="number"
                          min="25000"
                          step="5000"
                          value={editForm.baseSalary}
                          onChange={setField("baseSalary")}
                          hint="Minimum PKR 25,000 used to generate this employee's payroll"
                        />
                        <TextField label="Bank Name" value={editForm.bankName} onChange={setField("bankName")} placeholder="e.g. HBL, Meezan Bank" />
                        <TextField label="Bank Account Number" value={editForm.bankAccountNumber} onChange={setField("bankAccountNumber")} hint="Stored encrypted used for payroll disbursement" />
                      </FormGroup>
                    </>
                  )}
                  {editError && <p className="col-span-full text-sm text-danger">{editError}</p>}
                  <button type="submit" disabled={saveEdit.isPending} className="pill-accent col-span-full flex items-center justify-center gap-1.5 justify-self-end px-5 py-2.5 text-sm disabled:opacity-60">
                    <Check size={14} /> {saveEdit.isPending ? "Saving…" : "Save changes"}
                  </button>
                </form>
              ) : (
                <div className="space-y-5">
                  {/* Department, role, status, level and employee type are
                      already shown in the profile card, so they aren't
                      repeated here. */}
                  <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))]">
                  <DetailGroup title="Contact">
                    <FieldValue label="Company Email" value={employee.email} />
                    <FieldValue label="Phone" value={employee.phone} />
                    <FieldValue label="Personal Email" value={employee.personalEmail} />
                  </DetailGroup>
                  <DetailGroup title="Employment">
                    <FieldValue label="Designation" value={employee.designation} />
                    <FieldValue label="Reporting Manager" value={employee.manager?.name} />
                    <FieldValue label="Skill" value={employee.skill} />
                    <FieldValue label="Joining date" value={fmtDate(employee.joiningDate)} />
                    <FieldValue label="Start date" value={fmtDate(employee.startDate)} />
                    <FieldValue
                      label="Employment status"
                      value={employee.employmentStatus === "PERMANENT"
                        ? `Permanent${employee.permanentDate ? ` since ${fmtDate(employee.permanentDate)}` : ""}`
                        : employee.employmentStatus === "PROBATION" ? "Probation" : null}
                    />
                    <FieldValue label="Shift" value={employee.shiftStart || employee.shiftEnd ? `${formatClock(employee.shiftStart) || "—"} - ${formatClock(employee.shiftEnd) || "—"}` : null} />
                  </DetailGroup>
                  {showPersonalDetails && (
                    <>
                      <DetailGroup title="Personal / Identification">
                        <FieldValue label="Father Name" value={employee.fatherName} />
                        <FieldValue label="CNIC" value={employee.cnic} />
                        <FieldValue label="Passport Number" value={employee.passportNumber} />
                        <FieldValue label="Civil Number" value={employee.civilNumber} />
                        <FieldValue label="Nationality" value={employee.nationality} />
                        <FieldValue label="Date of birth" value={fmtDate(employee.dob)} />
                        <FieldValue label="Location / Residence" value={employee.address} />
                      </DetailGroup>
                      <DetailGroup title="Emergency contact">
                        <FieldValue label="Name" value={employee.emergencyContactName} />
                        <FieldValue label="Relationship" value={employee.emergencyContactRelationship} />
                        <FieldValue label="Phone" value={employee.emergencyContactPhone} />
                        <FieldValue label="Alternate phone" value={employee.emergencyContactAltPhone} />
                        <FieldValue label="Address" value={employee.emergencyContactAddress} />
                        {employee.emergencyContactNotes && <FieldValue label="Other information" value={employee.emergencyContactNotes} />}
                      </DetailGroup>
                      <DetailGroup title="Recruitment & education">
                        <FieldValue label="Agent Name" value={employee.agentName} />
                        <FieldValue label="Education" value={employee.education} />
                        <FieldValue label="University" value={employee.currentUniversity} />
                        <FieldValue
                          label="LinkedIn"
                          value={employee.linkedinUrl && <a href={employee.linkedinUrl} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">{employee.linkedinUrl}</a>}
                        />
                      </DetailGroup>
                    </>
                  )}
                  {showFinancial && (
                    <DetailGroup title="Payroll & bank">
                      <FieldValue label="Base Salary" value={employee.baseSalary != null && employee.baseSalary !== "" ? `PKR ${Number(employee.baseSalary).toLocaleString()} / month` : null} />
                      <FieldValue label="Bank Name" value={employee.bankName} />
                      <FieldValue label="Bank Account Number" value={employee.bankAccountNumber} />
                    </DetailGroup>
                  )}
                  </div>

                  {Array.isArray(employee.documents) && (
                    <EmployeeDocuments employeeId={employee.id} documents={employee.documents} canManage={canManageDocuments} />
                  )}

                  {canManageCertifications && (
                    <div className="w-full border-t border-border pt-4 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Certifications</p>
                          <p className="mt-0.5 text-[11px] text-muted-2">{isSelf ? "Add your certificates and credentials." : "Add verified certificates and credentials."}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCertificateDrafts((items) => [...items, { name: "", institute: "", credentialId: "", credentialUrl: "", issuedDate: "", expiryDate: "", notes: "" }])}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong bg-surface text-ink hover:bg-surface-2"
                          title="Add certification"
                          aria-label="Add certification"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {certificateDrafts.map((certificate, index) => (
                          <div key={certificate.id || `new-${index}`} className="rounded-2xl border border-border bg-surface-2 p-3">
                            <div className="grid grid-cols-1 gap-2">
                              <TextField label="Certificate name" value={certificate.name} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} placeholder="e.g. AWS Certified Developer" />
                              <TextField label="Institute" value={certificate.institute} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, institute: e.target.value } : item))} placeholder="Issuing institute" />
                              <TextField label="Credential ID" value={certificate.credentialId} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, credentialId: e.target.value } : item))} />
                              <TextField label="Verification URL" type="url" value={certificate.credentialUrl} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, credentialUrl: e.target.value } : item))} placeholder="https://..." />
                              <div className="grid grid-cols-2 gap-2">
                                <TextField label="Issued" type="date" value={certificate.issuedDate} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, issuedDate: e.target.value } : item))} />
                                <TextField label="Expiry" type="date" value={certificate.expiryDate} onChange={(e) => setCertificateDrafts((items) => items.map((item, i) => i === index ? { ...item, expiryDate: e.target.value } : item))} />
                              </div>
                              <div className="flex items-center justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (certificate.id) deleteCertification.mutate(certificate.id)
                                    else setCertificateDrafts((items) => items.filter((_, i) => i !== index))
                                  }}
                                  className="flex h-8 w-8 items-center justify-center rounded-full border border-border-strong bg-surface text-danger hover:bg-chip-pink-bg"
                                  title="Remove certification"
                                  aria-label="Remove certification"
                                >
                                  <Minus size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveCertification.mutate({ certificateId: certificate.id, data: certificate, index })}
                                  disabled={saveCertification.isPending || !certificate.name.trim() || !certificate.institute.trim()}
                                  className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-on-accent disabled:opacity-50"
                                >
                                  <Save size={12} /> Save
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {certificateError && <p className="col-span-full text-xs text-danger">{certificateError}</p>}
                        {certificateDrafts.length === 0 && <p className="col-span-full text-xs text-muted">No certifications added. Use + to add one.</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>}
            </section>
      )}

      {/* Decorative organization-name particles — a subtle footer element in
          normal flow after all content, so it never overlaps cards. It takes
          pointer input (dots scatter away from the cursor), but the canvas's
          own touch-none is overridden so swiping over it still scrolls. */}
      <div
        aria-hidden="true"
        className="mt-8 h-[155px] w-full select-none overflow-hidden sm:h-[170px] [&_canvas]:touch-auto"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 30%, #000 70%, transparent)",
        }}
      >
        <ParticleText
          text={(organizationName && organizationName.trim() ? organizationName : "MANAGEMENTDOCK").toUpperCase()}
          height={170}
          background="transparent"
          // Black dots in light mode, white in dark mode; the yellow accent
          // dots stay the same in both.
          dotColor={themeMode === "dark" ? "rgba(255, 255, 255, 0.9)" : "rgba(17, 17, 17, 0.85)"}
          accentColor="rgba(211, 151, 0, 0.9)"
          repelRadius={140}
          repelStrength={210}
          ease={0.065}
        />
      </div>
    </div>
  )
}
