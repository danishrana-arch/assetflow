import { useEffect, useMemo, useState } from "react"
import { useParams, Link, useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck, Plus, X, Boxes, Ticket as TicketIcon, Activity, UserX, Pencil, Check,
  Mail, Phone, KeyRound, ChevronDown, ChevronUp, Laptop, PackageSearch, MapPin,
  Calendar, Users as ManagerIcon, Briefcase, Send, AlertTriangle, Save, Minus,
} from "lucide-react"
import api from "../api/client"
import { useAuth } from "../context/AuthContext"
import { isManagement, canManageInventory, ROLE_LABELS } from "../utils/roles"
import StatusBadge from "../components/StatusBadge"
import ParticleText from "../components/ParticleText"
import StatusPill from "../components/ui/StatusPill"
import PageHeader from "../components/ui/PageHeader"
import Avatar from "../components/ui/Avatar"
import IconChip from "../components/ui/IconChip"
import SectionHeader from "../components/ui/SectionHeader"
import { FieldValue, TextField, SelectField } from "../components/ui/Field"
import EmptyState from "../components/ui/EmptyState"

const LEVEL_LABEL = { INTERN: "Intern", JUNIOR: "Junior", SENIOR: "Senior", LEAD: "Lead" }
const REQUEST_TONE = { PENDING: "yellow", APPROVED: "blue", REJECTED: "pink", FULFILLED: "green" }
const LEVEL_TONE = { INTERN: "slate", JUNIOR: "blue", SENIOR: "green", LEAD: "yellow" }
const WORK_LOCATION_LABEL = { OFFICE: "Office", FIELD: "Field / Remote" }

function fmtDate(value) {
  if (!value) return undefined
  return new Date(value).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" })
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
  // Management can edit every field on anyone (including themselves); a
  // non-management viewer can only edit their own phone/email.
  const canEditFully = isManagement(user?.role)
  const canEditContactOnly = !canEditFully && isSelf && user?.role !== "IT_MANAGER"
  // Only the Owner (ADMIN) can remove an employee outright.
  const canRemoveEmployee = user?.role === "ADMIN" && user?.id !== id
  // Any management user can reset a forgotten password to the temp value.
  const canResetPassword = isManagement(user?.role) && !isSelf
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
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [assetTab, setAssetTab] = useState("ALL")
  const [usageDrafts, setUsageDrafts] = useState({}) // { [assetId]: { notUsing: bool, actual: string } }
  const [usageSubmitted, setUsageSubmitted] = useState({}) // { [assetId]: true }
  const [certificateDrafts, setCertificateDrafts] = useState([])
  const canManageCertifications = ["ADMIN", "CEO"].includes(user?.role)

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", id],
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
  })

  useEffect(() => {
    if (!employee) return
    setCertificateDrafts((employee.certifications || []).map((certificate) => ({
      id: certificate.id,
      name: certificate.name || "",
      institute: certificate.institute || "",
      credentialId: certificate.credentialId || "",
      credentialUrl: certificate.credentialUrl || "",
      issuedDate: certificate.issuedDate ? certificate.issuedDate.slice(0, 10) : "",
      expiryDate: certificate.expiryDate ? certificate.expiryDate.slice(0, 10) : "",
      notes: certificate.notes || "",
    })))
  }, [employee])

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
    queryFn: () => api.get("/employees", { params: { page: 1, pageSize: 100 } }).then((r) => r.data?.data || []),
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

  const saveCertification = useMutation({
    mutationFn: ({ certificateId, data }) => certificateId
      ? api.patch(`/employees/${id}/certifications/${certificateId}`, data)
      : api.post(`/employees/${id}/certifications`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee", id] })
    },
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
      workLocationType: employee.workLocationType || "OFFICE",
    })
    setEditError("")
    setEditing(true)
  }

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

  // Today's attendance record (date-only comparison)
  const todayIso = new Date().toISOString().slice(0, 10)
  const todayRecord = (employee.attendanceRecords || []).find((r) => {
    const d = r.date ? (typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)) : null
    return d === todayIso
  })

  const level = employee.seniorityLevel
  const levelTone = LEVEL_TONE[level] || "slate"
  const canEdit = canEditFully || canEditContactOnly

  const assignedAssets = employee.assignedAssets || []
  const laptopCount = assignedAssets.filter((a) => assetTabOf(a) === "LAPTOP").length
  const accessoryCount = assignedAssets.length - laptopCount
  const visibleAssets = assignedAssets.filter((a) => assetTab === "ALL" || assetTabOf(a) === assetTab)

  function setUsageDraft(assetId, patch) {
    setUsageDrafts((prev) => ({ ...prev, [assetId]: { notUsing: false, actual: "", ...prev[assetId], ...patch } }))
  }

  return (
    <div>
      <PageHeader
        title="Employee Profile"
        subtitle="Personal information, assigned assets and activity."
        backTo={canManageAssets || isManagement(user?.role) ? "/employees" : "/"}
        actions={
          canRemoveEmployee && (
            <button
              onClick={handleRemoveEmployee}
              disabled={removeEmployee.isPending}
              className="pill-secondary flex items-center gap-1.5 px-4 py-2.5 text-sm text-danger disabled:opacity-60"
            >
              <UserX size={15} />
              {removeEmployee.isPending ? "Removing…" : "Remove Employee"}
            </button>
          )
        }
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

      {/* Small particle banner showing employee's organization */}
      <div
        className="mt-2 w-full overflow-hidden rounded-2xl border border-black/5 shadow-[0_18px_50px_rgba(0,0,0,0.10)] dark:border-white/5"
        style={{ backgroundColor: "#050629" }}
      >
        <div className="h-[120px] w-full sm:h-[160px] lg:h-[200px]">
          <ParticleText
            text={(employee?.organization?.name && employee.organization.name.trim() ? employee.organization.name : "ASSETFLOW").toUpperCase()}
            height={200}
            repelRadius={155}
            repelStrength={210}
            ease={0.065}
          />
        </div>
      </div>

      {/* Top identity bar — name / designation / reporting manager / company
          email on the left, company name tag in the org's brand color on
          the right. */}
      <div className="card mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={employee.name} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>
              {employee.name}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              {(employee.designation || employee.skill) && (
                <span className="flex items-center gap-1">
                  <Briefcase size={12} /> {employee.designation || employee.skill}
                </span>
              )}
              {employee.manager?.name && (
                <span className="flex items-center gap-1">
                  <ManagerIcon size={12} /> Reports to {employee.manager.name}
                </span>
              )}
              {employee.email && (
                <span className="flex items-center gap-1">
                  <Mail size={12} /> {employee.email}
                </span>
              )}
            </div>
          </div>
        </div>
        {organization?.name && (
          <span
            className="inline-flex shrink-0 items-center rounded-full px-3.5 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: organization.primaryColor || "#3B82F6" }}
          >
            {organization.name}
          </span>
        )}

        {/** Attendance timeline & status for today's record (visible to admins/CEO and employee) */}
        {todayRecord && (
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink">Today's shift</p>
                {todayRecord.status === "LATE" && (
                  <StatusPill tone="yellow">LATE</StatusPill>
                )}
              </div>
              <div className="text-xs text-muted">
                {todayRecord.checkInAt ? new Date(todayRecord.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}
                {todayRecord.checkOutAt ? ` — ${new Date(todayRecord.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
              </div>
            </div>

            {/* Timeline bar */}
            <div className="mt-2 h-3 w-full rounded-full bg-surface-2 relative overflow-hidden">
              {(() => {
                const shiftStartStr = employee.shiftStart || organization?.shiftStartDefault || "09:00"
                const workingHours = Number(organization?.workingHoursPerDay || 8)
                const parseHHMM = (s) => { const [h,m] = String(s||"09:00").split(":").map((v)=>Number(v||0)); return (h||0)*60 + (m||0) }
                const shiftStart = parseHHMM(shiftStartStr)
                const shiftEnd = shiftStart + Math.round(workingHours * 60)
                const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
                const parseTime = (t) => t ? new Date(t) : null
                const inAt = parseTime(todayRecord.checkInAt) || null
                const outAt = parseTime(todayRecord.checkOutAt) || new Date()
                if (!inAt) return null
                const inMin = inAt.getHours()*60 + inAt.getMinutes()
                const outMin = outAt.getHours()*60 + outAt.getMinutes()
                const total = Math.max(1, shiftEnd - shiftStart)
                const workStart = clamp(inMin, shiftStart - total, shiftEnd + total)
                const workEnd = clamp(outMin, shiftStart - total, shiftEnd + total)
                const left = ((Math.max(workStart, shiftStart) - shiftStart) / total) * 100
                const width = ((Math.max(0, Math.min(workEnd, shiftEnd) - Math.max(workStart, shiftStart))) / total) * 100
                const leftOverflow = workStart < shiftStart ? ((shiftStart - workStart) / total) * 100 : 0
                const rightOverflow = workEnd > shiftEnd ? ((workEnd - shiftEnd) / total) * 100 : 0
                const color = organization?.primaryColor || "#3B82F6"
                return (
                  <>
                    {/* worked inside shift */}
                    <div style={{ left: `${left}%`, width: `${width}%` }} className="absolute top-0 h-3" />
                    <div style={{ left: `${left}%`, width: `${width}%`, backgroundColor: color }} className="absolute top-0 h-3 rounded-full" />
                    {/* overflow left */}
                    {leftOverflow > 0 && (
                      <div style={{ left: `${-leftOverflow}%`, width: `${leftOverflow}%`, backgroundColor: "#ff4d4f" }} className="absolute top-0 h-3 rounded-full" />
                    )}
                    {/* overflow right */}
                    {rightOverflow > 0 && (
                      <div style={{ right: `${-rightOverflow}%`, width: `${rightOverflow}%`, backgroundColor: "#ff4d4f" }} className="absolute top-0 h-3 rounded-full" />
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        )}
      </div>

      {!isIT && (
        <>
      {/* Employee 360 overview */}
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(() => {
          const attendance = employee.attendanceRecords || []
          const present = attendance.filter(a => ["PRESENT","LATE"].includes(a.status)).length
          const attendancePct = attendance.length ? Math.round((present / attendance.length) * 100) : 0
          const activeProjects = (employee.projectMemberships || []).filter(m => m.project?.status === "IN_PROGRESS").length
          const completedProjects = (employee.projectMemberships || []).filter(m => m.project?.status === "COMPLETED").length
          const year = new Date().getFullYear()
          const leaveDays = (employee.leaveApplications || []).filter(l => new Date(l.startDate).getFullYear() === year).reduce((sum,l) => sum + Math.max(1, Math.round((new Date(l.endDate)-new Date(l.startDate))/86400000)+1),0)
          const allowance = Number(employee.organization?.casualLeaveAllowance || 0) + Number(employee.organization?.sickLeaveAllowance || 0)
          const remaining = Math.max(0, allowance - leaveDays)
          return <>
            <div className="card p-4"><p className="text-xs text-muted">Attendance</p><p className="mt-1 text-2xl font-semibold text-ink">{attendancePct}%</p><p className="text-[11px] text-muted">Last 90 records</p></div>
            <div className="card p-4"><p className="text-xs text-muted">Leave remaining</p><p className="mt-1 text-2xl font-semibold text-ink">{remaining}</p><p className="text-[11px] text-muted">Approved days this year: {leaveDays}</p></div>
            <div className="card p-4"><p className="text-xs text-muted">Projects</p><p className="mt-1 text-2xl font-semibold text-ink">{activeProjects}</p><p className="text-[11px] text-muted">{completedProjects} completed</p></div>
            <div className="card p-4"><p className="text-xs text-muted">Assigned assets</p><p className="mt-1 text-2xl font-semibold text-ink">{assignedAssets.length}</p><p className="text-[11px] text-muted">Current assignments</p></div>
          </>
        })()}
      </section>
      <section className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="card p-5"><SectionHeader title="Projects & time"/><div className="mt-3 space-y-2">{(employee.projectMemberships||[]).slice(0,6).map(m=><div key={m.id} className="flex items-center justify-between rounded-2xl bg-surface-2 p-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{m.project?.name}</p><p className="text-xs text-muted">{m.project?.status?.replaceAll("_"," ")} · {Number(m.hoursSpent||0).toFixed(1)}h</p></div>{m.project?.deadline&&<span className="text-[11px] text-muted">Due {new Date(m.project.deadline).toLocaleDateString()}</span>}</div>)}{!(employee.projectMemberships||[]).length&&<p className="text-sm text-muted">No project assignments.</p>}</div></div>
        <div className="card p-5"><SectionHeader title="Recent payroll"/><div className="mt-3 space-y-2">{(employee.payrollRecords||[]).slice(0,5).map(p=><div key={p.id} className="flex items-center justify-between rounded-2xl bg-surface-2 p-3"><div><p className="text-sm font-semibold text-ink">{p.month}/{p.year}</p><p className="text-xs text-muted">{p.status}</p></div><span className="text-sm font-semibold text-ink">PKR {Number(p.netPay||0).toLocaleString()}</span></div>)}{!(employee.payrollRecords||[]).length&&<p className="text-sm text-muted">No payroll records.</p>}</div></div>
      </section>
        </>
      )}

      {isIT && (
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="card p-4"><p className="text-xs text-muted">Assigned assets</p><p className="mt-1 text-2xl font-semibold text-ink">{assignedAssets.length}</p><p className="text-[11px] text-muted">Current assignments</p></div>
          <div className="card p-4"><p className="text-xs text-muted">Laptops</p><p className="mt-1 text-2xl font-semibold text-ink">{laptopCount}</p><p className="text-[11px] text-muted">Assigned laptop devices</p></div>
          <div className="card p-4"><p className="text-xs text-muted">Accessories</p><p className="mt-1 text-2xl font-semibold text-ink">{accessoryCount}</p><p className="text-[11px] text-muted">Monitors, phones and accessories</p></div>
        </section>
      )}

      {/**/}
      {/* Contact panel + content, matching the AssetFlow contact-detail layout */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* LEFT — wider column: assets, tickets, activity */}
        <div className="space-y-5 lg:order-1 lg:col-span-2">
          {/* Assigned Assets */}
          {showAssets ? (
            <div className="card p-5">
              <SectionHeader
                title="Assigned Assets"
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
                    className="field flex-1"
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

              {/* Laptop / Accessories tabs */}
              <div className="mb-3 flex gap-1.5">
                {[
                  { key: "ALL", label: "All", count: assignedAssets.length },
                  { key: "LAPTOP", label: "Laptops", count: laptopCount },
                  { key: "ACCESSORY", label: "Accessories", count: accessoryCount },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setAssetTab(tab.key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                      assetTab === tab.key ? "pill-accent px-3 py-1.5" : "bg-surface-2 text-muted hover:text-ink"
                    }`}
                  >
                    {tab.key === "LAPTOP" && <Laptop size={11} />}
                    {tab.key === "ACCESSORY" && <PackageSearch size={11} />}
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              <ul className="max-h-96 space-y-2 overflow-y-auto">
                {visibleAssets.map((asset) => {
                  const draft = usageDrafts[asset.id] || { notUsing: false, actual: "" }
                  const submitted = usageSubmitted[asset.id]
                  return (
                    <li key={asset.id} className="rounded-2xl px-2 py-2 hover:bg-surface-2">
                      <div className="flex items-center gap-3">
                        <IconChip icon={assetTabOf(asset) === "LAPTOP" ? Laptop : Boxes} tone="blue" size="sm" />
                        <div className="min-w-0 flex-1">
                          <Link to={`/inventory/${asset.id}`} className="block truncate text-sm font-semibold text-ink hover:text-accent">
                            {asset.name}
                          </Link>
                          <p className="truncate font-mono text-[11px] text-muted">{asset.serialNumber}</p>
                        </div>
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
                        <div className="ml-11 mt-1.5">
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
                                    className="field flex-1 py-1.5 text-xs"
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
                {visibleAssets.length === 0 && (
                  <EmptyState icon={Boxes} title="No assets here" description="Nothing assigned in this category yet." />
                )}
              </ul>
            </div>
          ) : (
            <div className="card p-5">
              <SectionHeader title="Assigned Assets" />
              <p className="text-sm text-muted">Asset details aren't part of your department's view of this profile.</p>
            </div>
          )}

          {isSelf && (
            <div className="card p-5">
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

              <ul className="space-y-2">
                {(myRequests || []).map((r) => (
                  <li key={r.id} className="rounded-2xl bg-surface-2 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">{r.category}</p>
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
                {(myRequests || []).length === 0 && (
                  <EmptyState title="No requests yet" description="Need something? Submit a request above." />
                )}
              </ul>
            </div>
          )}

          {!isIT && (
          <div className="card p-5">
            <SectionHeader title="Support History" />
            <ul className="max-h-80 space-y-2 overflow-y-auto">
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
              {employee.tickets?.length === 0 && (
                <EmptyState icon={TicketIcon} title="No tickets" description="This employee hasn't raised any support requests." />
              )}
            </ul>
          </div>          )}

          {!isIT && (
          <div className="card p-5">
            <SectionHeader title="Activity" />
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {(employee.lifecycleEvents || []).map((event) => (
                <li key={event.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-surface-2">
                  <IconChip icon={Activity} tone="purple" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {event.asset?.name || "—"}
                    </p>
                    <p className="text-xs text-muted">
                      {(event.type || "").replaceAll("_", " ").toLowerCase()}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted">
                    {new Date(event.occurredAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
              {employee.lifecycleEvents?.length === 0 && (
                <EmptyState icon={Activity} title="No recent activity" />
              )}
            </ul>
          </div>
          )}
        </div>

        <div className="card p-6 lg:order-2">
          <div className="flex flex-col items-center text-center">
            <Avatar name={employee.name} size="2xl" />
            <h2 className="mt-4 text-xl font-bold text-ink" style={{ letterSpacing: "-0.02em" }}>
              {employee.name}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {employee.department?.name || "No department"}
              {organization?.name ? ` · ${organization.name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <StatusBadge type="employee" status={employee.status} />
              {level && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide bg-chip-${levelTone}-bg text-chip-${levelTone}-fg`}>
                  <BadgeCheck size={11} strokeWidth={2.5} />
                  {LEVEL_LABEL[level]}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <MapPin size={11} strokeWidth={2.5} />
                {WORK_LOCATION_LABEL[employee.workLocationType] || "Office"}
              </span>
            </div>



            <div className="mt-4 flex items-center gap-2">
              {canEdit && !editing && (
                <button
                  onClick={startEditing}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Edit"
                  title="Edit"
                >
                  <Pencil size={15} />
                </button>
              )}
              {employee.email && (
                <a
                  href={`mailto:${employee.email}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Email"
                  title="Email"
                >
                  <Mail size={15} />
                </a>
              )}
              {employee.phone && (
                <a
                  href={`tel:${employee.phone}`}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2"
                  aria-label="Call"
                  title="Call"
                >
                  <Phone size={15} />
                </a>
              )}
              {canResetPassword && (
                <button
                  onClick={handleResetPassword}
                  disabled={resetPassword.isPending}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-ink transition-colors hover:bg-surface-2 disabled:opacity-60"
                  aria-label="Reset password"
                  title="Reset password"
                >
                  <KeyRound size={15} />
                </button>
              )}
              {canRemoveEmployee && (
                <button
                  onClick={handleRemoveEmployee}
                  disabled={removeEmployee.isPending}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface text-danger transition-colors hover:bg-chip-pink-bg disabled:opacity-60"
                  aria-label="Remove employee"
                  title="Remove employee"
                >
                  <UserX size={15} />
                </button>
              )}
            </div>
          </div>

          {!isIT && (
            <>
          <div className="my-5 divider" />

          <SectionHeader
            title="Detailed Information"
            action={
              editing ? (
                <button onClick={() => setEditing(false)} className="pill-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                  <X size={12} /> Cancel
                </button>
              ) : null
            }
          />

          {editing ? (
            <form onSubmit={handleSaveEdit} className="grid grid-cols-1 gap-4">
              {canEditFully && (
                <TextField label="Full name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              )}
              <TextField label="Company Email" type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
              <TextField label="Phone" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
              {canEditFully && (
                <>
                  <TextField label="Personal Email" type="email" value={editForm.personalEmail} onChange={(e) => setEditForm((f) => ({ ...f, personalEmail: e.target.value }))} />
                  <TextField label="Father Name" value={editForm.fatherName} onChange={(e) => setEditForm((f) => ({ ...f, fatherName: e.target.value }))} />
                  <TextField label="Education" value={editForm.education} onChange={(e) => setEditForm((f) => ({ ...f, education: e.target.value }))} />
                  <TextField label="Current University" value={editForm.currentUniversity} onChange={(e) => setEditForm((f) => ({ ...f, currentUniversity: e.target.value }))} />
                  <TextField label="LinkedIn" value={editForm.linkedinUrl} onChange={(e) => setEditForm((f) => ({ ...f, linkedinUrl: e.target.value }))} placeholder="https://linkedin.com/in/..." />
                  <div className="grid grid-cols-2 gap-2">
                    <TextField label="Shift Start" type="time" value={editForm.shiftStart} onChange={(e) => setEditForm((f) => ({ ...f, shiftStart: e.target.value }))} />
                    <TextField label="Shift End" type="time" value={editForm.shiftEnd} onChange={(e) => setEditForm((f) => ({ ...f, shiftEnd: e.target.value }))} />
                  </div>
                </>
              )}
              {canEditFully && (
                <>
                  <TextField label="Designation / Title" value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} placeholder="e.g. Senior Backend Engineer" />
                  <TextField label="Personal Email" type="email" value={editForm.personalEmail} onChange={(e) => setEditForm((f) => ({ ...f, personalEmail: e.target.value }))} />
                  <TextField label="Father Name" value={editForm.fatherName} onChange={(e) => setEditForm((f) => ({ ...f, fatherName: e.target.value }))} />
                  <TextField label="Education" value={editForm.education} onChange={(e) => setEditForm((f) => ({ ...f, education: e.target.value }))} placeholder="e.g. BS Computer Science" />
                  <TextField label="Current University" value={editForm.currentUniversity} onChange={(e) => setEditForm((f) => ({ ...f, currentUniversity: e.target.value }))} />
                  <TextField label="LinkedIn URL" value={editForm.linkedinUrl} onChange={(e) => setEditForm((f) => ({ ...f, linkedinUrl: e.target.value }))} placeholder="https://www.linkedin.com/in/..." />
                  <TextField label="Shift Start" type="time" value={editForm.shiftStart} onChange={(e) => setEditForm((f) => ({ ...f, shiftStart: e.target.value }))} />
                  <TextField label="Shift End" type="time" value={editForm.shiftEnd} onChange={(e) => setEditForm((f) => ({ ...f, shiftEnd: e.target.value }))} />
                  <SelectField label="Department" value={editForm.departmentId} onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}>
                    <option value="">None</option>
                    {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </SelectField>
                  <SelectField label="Role" value={editForm.role} onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                    {Object.entries(ROLE_LABELS)
                      .filter(([value]) => ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD", "IT_MANAGER", "EMPLOYEE"].includes(value))
                      .filter(([value]) => value !== "CEO" || employee.role === "CEO" || (managerOptions || []).filter((m) => m.role === "CEO").length < 2)
                      .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </SelectField>
                  <SelectField label="Reporting Manager" value={editForm.managerId} onChange={(e) => setEditForm((f) => ({ ...f, managerId: e.target.value }))}>
                    <option value="">None</option>
                    {(managerOptions || []).filter((manager) => manager.id !== employee.id).map((manager) => (
                      <option key={manager.id} value={manager.id}>{manager.name} — {ROLE_LABELS[manager.role] || manager.role}</option>
                    ))}
                  </SelectField>
                  <SelectField label="Status" value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="ACTIVE">Active</option>
                    <option value="ON_LEAVE">On Leave</option>
                    <option value="LEFT_COMPANY">Left Company</option>
                  </SelectField>
                  <SelectField
                    label="Employee type"
                    value={editForm.workLocationType}
                    onChange={(e) => setEditForm((f) => ({ ...f, workLocationType: e.target.value }))}
                  >
                    <option value="OFFICE">Office (attendance geofence applies)</option>
                    <option value="FIELD">Field / Remote (exempt from geofence)</option>
                  </SelectField>
                  <TextField label="CNIC" value={editForm.cnic} onChange={(e) => setEditForm((f) => ({ ...f, cnic: e.target.value }))} placeholder="XXXXX-XXXXXXX-X" hint="Stored encrypted" />
                  <TextField label="Date of birth" type="date" value={editForm.dob} onChange={(e) => setEditForm((f) => ({ ...f, dob: e.target.value }))} />
                  <TextField label="Joining date" type="date" value={editForm.joiningDate} onChange={(e) => setEditForm((f) => ({ ...f, joiningDate: e.target.value }))} />
                  <TextField label="Location / Residence" value={editForm.address} onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))} />
                  <TextField label="Skill" value={editForm.skill} onChange={(e) => setEditForm((f) => ({ ...f, skill: e.target.value }))} />
                  <SelectField label="Level" value={editForm.seniorityLevel} onChange={(e) => setEditForm((f) => ({ ...f, seniorityLevel: e.target.value }))}>
                    <option value="">None</option>
                    <option value="INTERN">Intern</option>
                    <option value="JUNIOR">Junior</option>
                    <option value="SENIOR">Senior</option>
                    <option value="LEAD">Lead</option>
                  </SelectField>
                  <TextField
                    label="Base Salary (PKR / month)"
                    type="number"
                    min="25000"
                    step="5000"
                    value={editForm.baseSalary}
                    onChange={(e) => setEditForm((f) => ({ ...f, baseSalary: e.target.value }))}
                    hint="Minimum PKR 25,000 used to generate this employee's payroll"
                  />
                  <TextField
                    label="Bank Name"
                    value={editForm.bankName}
                    onChange={(e) => setEditForm((f) => ({ ...f, bankName: e.target.value }))}
                    placeholder="e.g. HBL, Meezan Bank"
                  />
                  <TextField
                    label="Bank Account Number"
                    value={editForm.bankAccountNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                    hint="Stored encrypted used for payroll disbursement"
                  />
                </>
              )}
              {editError && <p className="text-sm text-danger">{editError}</p>}
              <button type="submit" disabled={saveEdit.isPending} className="pill-accent flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm disabled:opacity-60">
                <Check size={14} /> {saveEdit.isPending ? "Saving…" : "Save changes"}
              </button>
            </form>
          ) : (
            <div className="space-y-3.5">
              <FieldValue label="Company Email" value={employee.email} />
              <FieldValue label="Personal Email" value={employee.personalEmail} />
              <FieldValue label="Phone" value={employee.phone} />
              <FieldValue label="Designation" value={employee.designation || employee.skill} />
              <FieldValue label="Department" value={employee.department?.name} />
              <FieldValue label="Reporting Manager" value={employee.manager?.name} />

            {canManageCertifications && (
              <div className="mt-5 w-full border-t border-border pt-4 text-left">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Certifications</p>
                    <p className="mt-0.5 text-[11px] text-muted-2">Add verified certificates and credentials.</p>
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

                <div className="mt-3 space-y-3">
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
                            onClick={() => saveCertification.mutate({ certificateId: certificate.id, data: certificate })}
                            disabled={saveCertification.isPending || !certificate.name.trim() || !certificate.institute.trim()}
                            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            <Save size={12} /> Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {certificateDrafts.length === 0 && <p className="text-xs text-muted">No certifications added. Use + to add one.</p>}
                </div>
              </div>
            )}
              {/* Collapsible "more details" card — DOB, joining date,
                  location and other less-frequently-needed fields. */}
              <div className="!mt-4 overflow-hidden rounded-2xl border border-border">
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-3.5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink"
                >
                  More details
                  {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {detailsOpen && (
                  <div className="space-y-3.5 border-t border-border bg-surface-2 px-3.5 py-4">
                    {showPersonalDetails ? (
                      <>
                        <FieldValue label="Father Name" value={employee.fatherName} />
                        <FieldValue label="Education" value={employee.education} />
                        <FieldValue label="Current University" value={employee.currentUniversity} />
                        <FieldValue label="LinkedIn" value={employee.linkedinUrl} />
                        <FieldValue label="Shift" value={employee.shiftStart && employee.shiftEnd ? `${employee.shiftStart} - ${employee.shiftEnd}` : employee.shiftStart || employee.shiftEnd} />
                        <FieldValue label="Date of Birth" value={fmtDate(employee.dob)} />
                        <FieldValue
                          label="Joining Date"
                          value={fmtDate(employee.joiningDate) || fmtDate(employee.createdAt)}
                        />
                        <FieldValue label="Location" value={employee.address} />
                        <FieldValue label="CNIC" value={employee.cnic} />
                        <FieldValue label="Level" value={level && LEVEL_LABEL[level]} />
                      </>
                    ) : (
                      <FieldValue
                        label="Joining Date"
                        value={fmtDate(employee.joiningDate) || fmtDate(employee.createdAt)}
                      />
                    )}
                    {showFinancial && (
                      <>
                        <FieldValue label="Base Salary" value={employee.baseSalary != null ? `PKR ${Number(employee.baseSalary).toLocaleString(undefined, { minimumFractionDigits: 2 })} / month` : undefined} />
                        <FieldValue label="Bank" value={employee.bankName} />
                        <FieldValue label="Account Number" value={employee.bankAccountNumber} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
