const ExcelJS = require("exceljs")
const prisma = require("../lib/prisma")
const { toDateOnly, dateKey, addDaysUTC } = require("../utils/date")
const { getTimeZone, localMinutes, parseHHMM } = require("../utils/timezone")
const { calculateWorkingMinutes, isScheduledWorkday } = require("../utils/work-schedule")
const { accessibleOrganizations } = require("../utils/organization")

// HR report generator behind GET /api/reports/hr. Every report type runs
// through the same pipeline — resolve the caller's authorized orgs, build
// the rows from real DB data, then return JSON (preview) or stream the
// exact same rows as CSV/XLSX — so an export always matches the preview
// generated with the same filters.

const REPORT_TYPES = ["attendance", "employees", "leave", "late-absence", "anomalies", "headcount", "payroll-adjustments", "site-admin-activity"]
const DATE_REQUIRED = new Set(["attendance", "leave", "late-absence", "anomalies", "payroll-adjustments", "site-admin-activity"])
// Day results from the attendance engine, accepted as a "status" filter.
const DAY_TYPE_FILTERS = ["HALF_DAY", "EARLY_GOING", "FULL_DAY"]
const ATTENDANCE_STATUSES = ["PRESENT", "LATE", "ABSENT", "LEAVE"]
const DAY_TYPE_LABEL = { FULL_DAY: "Full day", HALF_DAY: "Half day", EARLY_GOING: "Early going" }
const MAX_RANGE_DAYS = 366
const PREVIEW_LIMIT = 500
// Reports with one row per employee per day are shown/exported date by
// date (one page / one Excel sheet per date), so their preview carries more
// rows for the frontend to page through.
const DATE_GROUPED = new Set(["attendance", "late-absence", "anomalies", "site-admin-activity"])
const GROUPED_PREVIEW_LIMIT = 5000

// Row highlight shared by the preview, Excel and print: absent → red,
// late → yellow. Mirrors the frontend's rowTone().
function rowTone(row) {
  if (row.status === "ABSENT") return "absent"
  if (row.dayResult === "Half day" || row.dayResult === "Early going") return "late"
  if (row.status === "LATE" || String(row.late || "").startsWith("Late")) return "late"
  return null
}
const TONE_FILL = { absent: "FFFDE2E2", late: "FFFFF4CC" }

// Same rule as applyOrganizationScope (auth.middleware.js) and
// the company selector: a CEO, or an ADMIN of the Grand Parent / Parent
// (downward only), may report across every active
// organization in the company. Everyone else — including HR, main-company
// or not — is limited to their own home organization.
async function authorizedOrganizations(userId, role) {
  // Company hierarchy (utils/organization.js): only CEO / ADMIN reach beyond
  // their own organization here; HR is always own-organization only.
  const effectiveRole = ["CEO", "ADMIN"].includes(role) ? role : "EMPLOYEE"
  const orgs = await accessibleOrganizations(prisma, { userId, role: effectiveRole })
  return orgs.map((o) => ({ id: o.id, name: o.name }))
}

function badRequest(res, error) {
  return res.status(400).json({ error })
}

// ---------- formatting helpers ----------
function fmtDate(d) {
  return d ? dateKey(new Date(d)) : ""
}
function fmtTime(value, tz) {
  if (!value) return ""
  return new Date(value).toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true })
}
function fmtDuration(minutes) {
  if (minutes == null || minutes === "") return ""
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}
function breakOverlapMinutes(checkInAt, checkOutAt, tz, breakStart, breakEnd) {
  const bs = parseHHMM(breakStart)
  const be = parseHHMM(breakEnd)
  if (bs == null || be == null || be <= bs || !checkInAt || !checkOutAt) return null
  const inMin = localMinutes(checkInAt, tz)
  const outMin = localMinutes(checkOutAt, tz)
  if (outMin <= inMin) return null
  return Math.max(0, Math.min(outMin, be) - Math.max(inMin, bs))
}
function lateByMinutes(record, employee, org, tz) {
  if (!record?.checkInAt) return null
  const shift = parseHHMM(employee?.shiftStart || org?.shiftStartDefault)
  if (shift == null) return null
  const diff = localMinutes(record.checkInAt, tz) - shift
  return diff > Number(org?.lateThresholdMinutes ?? 15) ? diff : null
}
function leaveDays(leave) {
  if (leave.isHalfDay) return 0.5
  return Math.round((toDateOnly(leave.endDate) - toDateOnly(leave.startDate)) / 86400000) + 1
}

// ---------- filters ----------
function parseRange(query) {
  const from = query.from ? toDateOnly(query.from) : null
  const to = query.to ? toDateOnly(query.to) : null
  if ((from && Number.isNaN(+from)) || (to && Number.isNaN(+to))) return { error: "Invalid date" }
  if (from && to && from > to) return { error: "'Date From' must be on or before 'Date To'" }
  if (from && to && (to - from) / 86400000 + 1 > MAX_RANGE_DAYS) return { error: `Date range can't exceed ${MAX_RANGE_DAYS} days` }
  return { from, to, endExclusive: to ? addDaysUTC(to, 1) : null }
}

function employeeWhere(orgIds, q) {
  return {
    organizationId: { in: orgIds },
    ...(q.departmentId ? { departmentId: String(q.departmentId) } : {}),
    ...(q.employeeId ? { id: String(q.employeeId) } : {}),
  }
}

// ---------- report builders ----------
const EMPLOYEE_SELECT = {
  id: true, name: true, email: true, role: true, status: true, shiftStart: true, organizationId: true,
  designation: true, joiningDate: true, createdAt: true,
  department: { select: { name: true } },
  manager: { select: { name: true } },
  organization: { select: { name: true } },
}

async function loadOrgSettings(orgIds) {
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, name: true, timezone: true, shiftStartDefault: true, lateThresholdMinutes: true, breakStart: true, breakEnd: true, workingDaysPerWeek: true, workingHoursPerDay: true, absentFineAmount: true },
  })
  return new Map(orgs.map((o) => [o.id, o]))
}

async function attendanceRows(orgIds, q, range, { onlyLateAbsent = false } = {}) {
  const [employees, orgMap, sites] = await Promise.all([
    prisma.user.findMany({ where: employeeWhere(orgIds, q), select: EMPLOYEE_SELECT, orderBy: { name: "asc" } }),
    loadOrgSettings(orgIds),
    prisma.attendanceSite.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, name: true, projectId: true, Project: { select: { name: true } } } }),
  ])
  const empById = new Map(employees.map((e) => [e.id, e]))
  const siteName = new Map(sites.map((s) => [s.id, s.name]))
  const siteProject = new Map(sites.map((s) => [s.id, s.Project?.name || ""]))
  const projectSiteIds = q.projectId ? sites.filter((s) => s.projectId === String(q.projectId)).map((s) => s.id) : null
  const status = String(q.status || "")
  const records = await prisma.attendanceRecord.findMany({
    where: {
      organizationId: { in: orgIds },
      employeeId: { in: [...empById.keys()] },
      date: { gte: range.from, lt: range.endExclusive },
      ...(q.siteId ? { siteId: String(q.siteId) } : {}),
      ...(projectSiteIds ? { siteId: { in: q.siteId ? projectSiteIds.filter((id) => id === String(q.siteId)) : projectSiteIds } } : {}),
      ...(!onlyLateAbsent && ATTENDANCE_STATUSES.includes(status) ? { status } : {}),
      ...(!onlyLateAbsent && DAY_TYPE_FILTERS.includes(status) ? { dayType: status } : {}),
      ...(q.markedById ? { markedById: String(q.markedById) } : {}),
      ...(q.siteAdminOnly === "1" ? { markedBy: { role: "SITE_ADMIN" } } : {}),
    },
    include: { markedBy: { select: { name: true, role: true } } },
    orderBy: [{ date: "asc" }],
  })
  const anomalies = records.length
    ? await prisma.attendanceAnomaly.findMany({ where: { attendanceId: { in: records.map((r) => r.id) } }, select: { attendanceId: true, type: true, resolvedAt: true } })
    : []
  const anomaliesByRecord = new Map()
  for (const a of anomalies) {
    if (!anomaliesByRecord.has(a.attendanceId)) anomaliesByRecord.set(a.attendanceId, [])
    anomaliesByRecord.get(a.attendanceId).push(`${a.type.replaceAll("_", " ").toLowerCase()}${a.resolvedAt ? " (resolved)" : ""}`)
  }

  const rows = []
  for (const r of records) {
    const emp = empById.get(r.employeeId)
    const org = orgMap.get(r.organizationId)
    const tz = getTimeZone(org?.timezone)
    const late = lateByMinutes(r, emp, org, tz)
    const isLate = r.status === "LATE" || late != null
    const shortDay = ["HALF_DAY", "EARLY_GOING"].includes(r.dayType) && ["PRESENT", "LATE"].includes(r.status)
    if (onlyLateAbsent && !(isLate || r.status === "ABSENT" || shortDay)) continue
    const perDay = Number(org?.absentFineAmount || 0)
    const worked = r.workingMinutes ?? calculateWorkingMinutes(r.checkInAt, r.checkOutAt, org)
    const brk = breakOverlapMinutes(r.checkInAt, r.checkOutAt, tz, org?.breakStart, org?.breakEnd)
    rows.push({
      _date: fmtDate(r.date),
      employee: emp?.name || "",
      employeeId: emp?.id || r.employeeId,
      organization: org?.name || "",
      department: emp?.department?.name || "",
      date: fmtDate(r.date),
      checkIn: fmtTime(r.checkInAt, tz),
      checkOut: fmtTime(r.checkOutAt, tz),
      worked: fmtDuration(worked),
      break: brk == null ? "" : fmtDuration(brk),
      status: r.status,
      late: isLate ? (late != null ? `Late by ${late} min` : "Late") : "On time",
      site: (r.siteId && siteName.get(r.siteId)) || "",
      project: (r.siteId && siteProject.get(r.siteId)) || "",
      checkOutSite: (r.checkOutSiteId && siteName.get(r.checkOutSiteId)) || "",
      locationMode: r.locationMode,
      dayResult: r.dayType ? DAY_TYPE_LABEL[r.dayType] : "",
      dayReason: r.dayTypeReason || "",
      lateMinutes: r.lateMinutes ?? "",
      earlyGoingMinutes: r.earlyGoingMinutes ?? "",
      halfDayDeduction: shortDay ? Math.round(Number(r.deductionDays || 0) * perDay * 100) / 100 : "",
      deductionDays: shortDay && r.deductionDays != null ? Number(r.deductionDays) : "",
      earlyGoingFine: shortDay && r.earlyGoingFine != null && Number(r.earlyGoingFine) > 0 ? Number(r.earlyGoingFine) : "",
      markedBy: r.markedBy?.name || "",
      markedByRole: r.markedBy?.role === "SITE_ADMIN" ? "Site Admin" : r.markedBy?.role ? r.markedBy.role.replace("_", " ") : "",
      source: r.source === "BIOMETRIC" ? "Biometric" : r.markedById && r.markedById === r.employeeId ? "Self" : r.markedById ? "Marked" : "System",
      anomalies: (anomaliesByRecord.get(r.id) || []).join("; "),
    })
  }

  // Late & Absence also counts scheduled workdays with no attendance record
  // at all, excluding org holidays and approved leave — the same "no record
  // means absent" rule the attendance sheet export uses, minus days off.
  if (onlyLateAbsent && (!q.status || q.status === "ABSENT") && !q.markedById && q.siteAdminOnly !== "1" && !q.siteId && !q.projectId) {
    const [holidays, leaves] = await Promise.all([
      prisma.holiday.findMany({ where: { organizationId: { in: orgIds }, date: { gte: range.from, lt: range.endExclusive } }, select: { organizationId: true, date: true } }),
      prisma.leaveApplication.findMany({
        where: { employeeId: { in: [...empById.keys()] }, status: "APPROVED", startDate: { lt: range.endExclusive }, endDate: { gte: range.from } },
        select: { employeeId: true, startDate: true, endDate: true },
      }),
    ])
    const holidayKeys = new Set(holidays.map((h) => `${h.organizationId}|${fmtDate(h.date)}`))
    const recordKeys = new Set(records.map((r) => `${r.employeeId}|${fmtDate(r.date)}`))
    const today = toDateOnly(new Date())
    for (const emp of employees) {
      if (emp.status === "LEFT_COMPANY") continue
      const org = orgMap.get(emp.organizationId)
      for (let d = new Date(range.from); d < range.endExclusive && d <= today; d = addDaysUTC(d, 1)) {
        const key = fmtDate(d)
        if (recordKeys.has(`${emp.id}|${key}`)) continue
        if (!isScheduledWorkday(new Date(`${key}T12:00:00Z`), org)) continue
        if (holidayKeys.has(`${emp.organizationId}|${key}`)) continue
        if (emp.joiningDate && toDateOnly(emp.joiningDate) > d) continue
        if (leaves.some((l) => l.employeeId === emp.id && toDateOnly(l.startDate) <= d && toDateOnly(l.endDate) >= d)) continue
        rows.push({
          _date: key, employee: emp.name, employeeId: emp.id, organization: org?.name || "", department: emp.department?.name || "",
          date: key, checkIn: "", checkOut: "", worked: "", break: "", status: "ABSENT", late: "No attendance recorded",
          site: "", project: "", checkOutSite: "", locationMode: "", dayResult: "", dayReason: "", lateMinutes: "", earlyGoingMinutes: "",
          halfDayDeduction: "", deductionDays: "", earlyGoingFine: "", markedBy: "", markedByRole: "", source: "", anomalies: "",
        })
      }
    }
  }

  rows.sort((a, b) => a._date.localeCompare(b._date) || a.employee.localeCompare(b.employee))
  const columns = [
    ["employee", "Employee"], ["organization", "Organization"], ["department", "Department"],
    ["date", "Date"], ["checkIn", "Check-in"], ["checkOut", "Check-out"], ["worked", "Worked"], ["break", "Break"],
    ["status", "Status"], ["late", "Late status"], ["dayResult", "Day result"], ["dayReason", "Reason"],
    ["lateMinutes", "Late (min)"], ["earlyGoingMinutes", "Early going (min)"], ["deductionDays", "Deduction (days)"],
    ["halfDayDeduction", "Half-day deduction"], ["earlyGoingFine", "Early-going fine"],
    ["site", "Attendance site"], ["checkOutSite", "Check-out site"], ["project", "Project"], ["locationMode", "Location mode"],
    ["markedBy", "Marked by"], ["markedByRole", "Marked by role"], ["source", "Source"], ["anomalies", "Anomalies"],
  ]
  const byStatus = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  const lateCount = rows.filter((r) => r.late.startsWith("Late")).length
  const sumOf = (key) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100
  return {
    columns,
    rows,
    summary: {
      ...byStatus,
      "Late (by check-in)": lateCount,
      "Full days": rows.filter((r) => r.dayResult === "Full day").length,
      "Half days": rows.filter((r) => r.dayResult === "Half day").length,
      "Early going": rows.filter((r) => r.dayResult === "Early going").length,
      "Half-day deductions": sumOf("halfDayDeduction"),
      "Early-going fines": sumOf("earlyGoingFine"),
      "Marked by Site Admin": rows.filter((r) => r.markedByRole === "Site Admin").length,
    },
  }
}

async function employeeRows(orgIds, q, range) {
  const employees = await prisma.user.findMany({
    where: {
      ...employeeWhere(orgIds, q),
      ...(q.employeeStatus ? { status: String(q.employeeStatus) } : {}),
      ...(range.from || range.to ? { joiningDate: { ...(range.from ? { gte: range.from } : {}), ...(range.endExclusive ? { lt: range.endExclusive } : {}) } } : {}),
    },
    select: EMPLOYEE_SELECT,
    orderBy: { name: "asc" },
  })
  const rows = employees.map((e) => ({
    employee: e.name, employeeId: e.id, email: e.email, organization: e.organization?.name || "", department: e.department?.name || "",
    role: e.role, designation: e.designation || "", manager: e.manager?.name || "", joiningDate: fmtDate(e.joiningDate), status: e.status,
  }))
  const columns = [
    ["employee", "Employee"], ["email", "Email"], ["organization", "Organization"], ["department", "Department"],
    ["role", "Role"], ["designation", "Designation"], ["manager", "Manager"], ["joiningDate", "Joining date"], ["status", "Employment status"],
  ]
  const summary = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  return { columns, rows, summary }
}

async function leaveRows(orgIds, q, range) {
  const leaves = await prisma.leaveApplication.findMany({
    where: {
      organizationId: { in: orgIds },
      employee: employeeWhere(orgIds, q),
      startDate: { lt: range.endExclusive },
      endDate: { gte: range.from },
      ...(q.leaveStatus
        ? String(q.leaveStatus) === "PENDING"
          ? { status: { in: ["PENDING_HR", "PENDING_FINAL_APPROVAL"] } }
          : ["PENDING_HR", "PENDING_FINAL_APPROVAL", "APPROVED", "REJECTED", "CANCELLED"].includes(String(q.leaveStatus))
            ? { status: String(q.leaveStatus) }
            : {}
        : {}),
      ...(q.leaveType ? { type: String(q.leaveType) } : {}),
    },
    include: { employee: { select: EMPLOYEE_SELECT }, reviewedBy: { select: { name: true } } },
    orderBy: [{ startDate: "asc" }],
  })
  const rows = leaves.map((l) => ({
    employee: l.employee?.name || "", employeeId: l.employeeId, organization: l.employee?.organization?.name || "", department: l.employee?.department?.name || "",
    type: l.type, startDate: fmtDate(l.startDate), endDate: fmtDate(l.endDate), days: leaveDays(l), halfDay: l.isHalfDay ? "Yes" : "No",
    status: l.status, reason: l.reason || "", reviewedBy: l.reviewedBy?.name || "", reviewNote: l.reviewNote || "",
  }))
  const columns = [
    ["employee", "Employee"], ["organization", "Organization"], ["department", "Department"], ["type", "Leave type"],
    ["startDate", "Start date"], ["endDate", "End date"], ["days", "Days"], ["halfDay", "Half day"], ["status", "Status"], ["reason", "Reason"],
    ["reviewedBy", "Reviewed by"], ["reviewNote", "Review note"],
  ]
  const summary = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  summary["Total days"] = rows.reduce((s, r) => s + Number(r.days || 0), 0)
  return { columns, rows, summary }
}

async function anomalyRows(orgIds, q, range) {
  const empIds = (await prisma.user.findMany({ where: employeeWhere(orgIds, q), select: { id: true } })).map((e) => e.id)
  const [anomalies, orgMap] = await Promise.all([
    prisma.attendanceAnomaly.findMany({
      where: {
        organizationId: { in: orgIds },
        employeeId: { in: empIds },
        createdAt: { gte: range.from, lt: range.endExclusive },
        ...(q.siteId ? { siteId: String(q.siteId) } : {}),
        ...(q.anomalyStatus === "OPEN" ? { resolvedAt: null } : q.anomalyStatus === "RESOLVED" ? { resolvedAt: { not: null } } : {}),
      },
      include: {
        User_AttendanceAnomaly_employeeIdToUser: { select: { name: true, department: { select: { name: true } } } },
        User_AttendanceAnomaly_resolvedByIdToUser: { select: { name: true } },
        AttendanceSite: { select: { name: true } },
        AttendanceRecord: { select: { date: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    loadOrgSettings(orgIds),
  ])
  const attendanceIds = anomalies.map((a) => a.attendanceId).filter(Boolean)
  const corrections = attendanceIds.length
    ? await prisma.attendanceCorrection.findMany({ where: { attendanceId: { in: attendanceIds } }, select: { attendanceId: true, status: true }, orderBy: { createdAt: "desc" } })
    : []
  const correctionByRecord = new Map()
  for (const c of corrections) if (!correctionByRecord.has(c.attendanceId)) correctionByRecord.set(c.attendanceId, c.status)

  const rows = anomalies.map((a) => {
    const org = orgMap.get(a.organizationId)
    const tz = getTimeZone(org?.timezone)
    const emp = a.User_AttendanceAnomaly_employeeIdToUser
    return {
      employee: emp?.name || "", employeeId: a.employeeId || "", organization: org?.name || "", department: emp?.department?.name || "",
      date: a.AttendanceRecord?.date ? fmtDate(a.AttendanceRecord.date) : fmtDate(a.createdAt),
      time: fmtTime(a.createdAt, tz), type: a.type, severity: a.severity, site: a.AttendanceSite?.name || "", description: a.message,
      status: a.resolvedAt ? "Resolved" : "Open", resolvedBy: a.User_AttendanceAnomaly_resolvedByIdToUser?.name || "",
      resolvedAt: a.resolvedAt ? `${fmtDate(a.resolvedAt)} ${fmtTime(a.resolvedAt, tz)}` : "",
      correction: (a.attendanceId && correctionByRecord.get(a.attendanceId)) || "",
    }
  })
  const columns = [
    ["employee", "Employee"], ["organization", "Organization"], ["department", "Department"], ["date", "Date"],
    ["time", "Time"], ["type", "Anomaly type"], ["severity", "Severity"], ["site", "Site"], ["description", "Description"], ["status", "Status"],
    ["resolvedBy", "Resolved by"], ["resolvedAt", "Resolved at"], ["correction", "Correction request"],
  ]
  const summary = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  return { columns, rows, summary }
}

async function headcountRows(orgIds, q, range) {
  const employees = await prisma.user.findMany({
    where: { ...employeeWhere(orgIds, q), ...(range.endExclusive ? { createdAt: { lt: range.endExclusive } } : {}) },
    select: { status: true, organization: { select: { name: true } }, department: { select: { name: true } } },
  })
  const groups = new Map()
  for (const e of employees) {
    const key = `${e.organization?.name || ""}|${e.department?.name || "No department"}`
    if (!groups.has(key)) groups.set(key, { organization: e.organization?.name || "", department: e.department?.name || "No department", total: 0, active: 0, onLeave: 0, left: 0 })
    const g = groups.get(key)
    g.total += 1
    if (e.status === "ACTIVE") g.active += 1
    else if (e.status === "ON_LEAVE") g.onLeave += 1
    else if (e.status === "LEFT_COMPANY") g.left += 1
  }
  const rows = [...groups.values()].sort((a, b) => a.organization.localeCompare(b.organization) || a.department.localeCompare(b.department))
  const columns = [["organization", "Organization"], ["department", "Department"], ["total", "Total"], ["active", "Active"], ["onLeave", "On leave"], ["left", "Left company"]]
  const byOrg = {}
  for (const r of rows) byOrg[r.organization] = (byOrg[r.organization] || 0) + r.total
  const summary = {
    "Total employees": employees.length,
    Active: employees.filter((e) => e.status === "ACTIVE").length,
    "Inactive (on leave / left)": employees.filter((e) => e.status !== "ACTIVE").length,
    Departments: rows.length,
    ...(Object.keys(byOrg).length > 1 ? Object.fromEntries(Object.entries(byOrg).map(([k, v]) => [`Org: ${k}`, v])) : {}),
  }
  return { columns, rows, summary }
}

const ADJUSTMENT_TYPE_LABEL = {
  REMOVE_FINE: "Remove fine", REDUCE_FINE: "Reduce fine", ADD_FINE: "Add fine", ADD_DEDUCTION: "Add deduction",
  REMOVE_DEDUCTION: "Remove / reduce deduction", ALLOWANCE: "Allowance", ATTENDANCE_CORRECTION: "Attendance correction",
  OTHER: "Other adjustment", REVERSAL: "Reversal", FIELD_EDIT: "Payslip edit",
}

// Every manual payroll change (adjustments and audited draft edits), by when
// it was made.
async function payrollAdjustmentRows(orgIds, q, range) {
  const adjustments = await prisma.payrollAdjustment.findMany({
    where: {
      organizationId: { in: orgIds },
      createdAt: { gte: range.from, lt: range.endExclusive },
      ...(q.employeeId ? { employeeId: String(q.employeeId) } : {}),
      ...(q.departmentId ? { payrollRecord: { employee: { departmentId: String(q.departmentId) } } } : {}),
    },
    include: {
      createdBy: { select: { name: true, role: true } },
      payrollRecord: { select: { month: true, year: true, employee: { select: { name: true, organization: { select: { name: true } }, department: { select: { name: true } } } } } },
    },
    orderBy: { createdAt: "asc" },
  })
  const orgMap = await loadOrgSettings(orgIds)
  const rows = adjustments.map((a) => {
    const tz = getTimeZone(orgMap.get(a.organizationId)?.timezone)
    const e = a.payrollRecord?.employee
    return {
      employee: e?.name || "", employeeId: a.employeeId, organization: e?.organization?.name || "", department: e?.department?.name || "",
      payPeriod: a.payrollRecord ? `${a.payrollRecord.year}-${String(a.payrollRecord.month).padStart(2, "0")}` : "",
      type: ADJUSTMENT_TYPE_LABEL[a.type] || a.type, line: a.line || "",
      amount: Number(a.amount), originalValue: a.originalValue == null ? "" : Number(a.originalValue), newValue: a.newValue == null ? "" : Number(a.newValue),
      previousNetPay: Number(a.previousNetPay), newNetPay: Number(a.newNetPay),
      reason: a.reason, payslipStatus: a.payslipStatus, finalizedOverride: a.finalizedOverride ? "Yes" : "No",
      changedBy: a.createdBy?.name || "", changedByRole: a.createdBy?.role || "",
      changedAt: `${fmtDate(a.createdAt)} ${fmtTime(a.createdAt, tz)}`,
    }
  })
  const columns = [
    ["employee", "Employee"], ["organization", "Organization"], ["department", "Department"], ["payPeriod", "Pay period"],
    ["type", "Type"], ["line", "Payslip line"], ["amount", "Effect on net pay"], ["originalValue", "Original value"], ["newValue", "New value"],
    ["previousNetPay", "Net pay before"], ["newNetPay", "Net pay after"], ["reason", "Reason"], ["payslipStatus", "Payslip status"],
    ["finalizedOverride", "Finalized override"], ["changedBy", "Changed by"], ["changedByRole", "Role"], ["changedAt", "Changed at"],
  ]
  const summary = {
    Adjustments: rows.filter((r) => r.type !== "Payslip edit").length,
    "Payslip edits": rows.filter((r) => r.type === "Payslip edit").length,
    "Net effect (adjustments)": Math.round(adjustments.filter((a) => a.type !== "FIELD_EDIT").reduce((s, a) => s + Number(a.amount), 0) * 100) / 100,
  }
  return { columns, rows, summary }
}

// Attendance actions performed by Site Admins (who, where, what, when).
async function siteAdminActivityRows(orgIds, q, range) {
  const events = await prisma.attendancePresenceEvent.findMany({
    where: {
      organizationId: { in: orgIds },
      actorId: q.markedById ? String(q.markedById) : { not: null },
      eventType: { startsWith: "SITE_ADMIN_" },
      recordedAt: { gte: addDaysUTC(range.from, -1), lt: addDaysUTC(range.endExclusive, 1) },
      ...(q.siteId ? { siteId: String(q.siteId) } : {}),
      ...(q.projectId ? { projectId: String(q.projectId) } : {}),
      ...(q.employeeId ? { employeeId: String(q.employeeId) } : {}),
    },
    include: { actor: { select: { name: true } }, AttendanceSite: { select: { name: true, timezone: true } } },
    orderBy: { recordedAt: "asc" },
  })
  const orgMap = await loadOrgSettings(orgIds)
  const fromKey = fmtDate(range.from)
  const toKey = fmtDate(range.to)
  const rows = []
  for (const e of events) {
    const org = orgMap.get(e.organizationId)
    const orgTz = getTimeZone(org?.timezone)
    const tz = getTimeZone(e.AttendanceSite?.timezone || org?.timezone)
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: orgTz }).format(e.recordedAt)
    if (day < fromKey || day > toKey) continue
    const m = e.metadata || {}
    rows.push({
      _date: day, date: day, time: fmtTime(e.recordedAt, tz),
      siteAdmin: e.actor?.name || m.actorName || "", employee: m.employeeName || "", employeeId: e.employeeId,
      organization: org?.name || "", site: e.AttendanceSite?.name || m.siteName || "", project: m.projectName || "",
      action: String(m.action || e.eventType.replace("SITE_ADMIN_", "")).replace("_", " "),
      previousStatus: m.previousStatus || "", newStatus: m.newStatus || "",
      checkIn: m.checkInAt ? fmtTime(m.checkInAt, tz) : "", checkOut: m.checkOutAt ? fmtTime(m.checkOutAt, tz) : "",
      source: m.source === "OFFLINE" ? "Offline (synced)" : "Online",
      location: e.inside === true ? "Inside site" : e.inside === false ? `Outside (${Math.round(e.distanceMeters || 0)}m)` : "No location",
      note: m.note || "",
    })
  }
  const columns = [
    ["date", "Date"], ["time", "Time"], ["siteAdmin", "Site Admin"], ["employee", "Employee"], ["organization", "Organization"],
    ["site", "Site"], ["project", "Project"], ["action", "Action"], ["previousStatus", "Previous status"], ["newStatus", "New status"],
    ["checkIn", "Check-in"], ["checkOut", "Check-out"], ["source", "Source"], ["location", "Site Admin location"], ["note", "Note"],
  ]
  const summary = rows.reduce((acc, r) => ({ ...acc, [r.action]: (acc[r.action] || 0) + 1 }), {})
  summary["Site Admins"] = new Set(rows.map((r) => r.siteAdmin)).size
  summary.Sites = new Set(rows.map((r) => r.site)).size
  return { columns, rows, summary }
}

const BUILDERS = {
  attendance: (o, q, r) => attendanceRows(o, q, r),
  "late-absence": (o, q, r) => attendanceRows(o, q, r, { onlyLateAbsent: true }),
  employees: employeeRows,
  leave: leaveRows,
  anomalies: anomalyRows,
  headcount: headcountRows,
  "payroll-adjustments": payrollAdjustmentRows,
  "site-admin-activity": siteAdminActivityRows,
}
const TITLES = {
  attendance: "Attendance Report", employees: "Employee Report", leave: "Leave Report",
  "late-absence": "Late & Absence Report", anomalies: "Attendance Anomalies Report", headcount: "Headcount Report",
  "payroll-adjustments": "Payroll Adjustments Report", "site-admin-activity": "Site Admin Activity Report",
}

// ---------- output ----------
function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`
}

function addReportSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name.slice(0, 31))
  sheet.columns = columns.map(([key, header]) => ({ header, key, width: Math.min(40, Math.max(12, header.length + 4)) }))
  for (const r of rows) {
    const added = sheet.addRow(r)
    const tone = rowTone(r)
    if (tone) {
      added.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL[tone] } }
      })
    }
  }
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return sheet
}

async function sendXlsx(res, filename, title, columns, rows, meta, { byDate = false } = {}) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "ManagementDock"
  if (byDate && rows.length) {
    // One sheet per date, named by the date (same convention as the
    // attendance sheet export).
    const groups = new Map()
    for (const r of rows) {
      if (!groups.has(r.date)) groups.set(r.date, [])
      groups.get(r.date).push(r)
    }
    for (const [date, dayRows] of groups) addReportSheet(workbook, date || "No date", columns, dayRows)
  } else {
    addReportSheet(workbook, title, columns, rows)
  }
  const info = workbook.addWorksheet("Report info")
  info.columns = [{ header: "Field", key: "k", width: 24 }, { header: "Value", key: "v", width: 60 }]
  Object.entries(meta).forEach(([k, v]) => info.addRow({ k, v }))
  if (rows.some((r) => rowTone(r))) {
    info.addRow({})
    const late = info.addRow({ k: "Yellow rows", v: "Late" })
    late.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL.late } }
    const absent = info.addRow({ k: "Red rows", v: "Absent" })
    absent.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TONE_FILL.absent } }
  }
  info.getRow(1).font = { bold: true }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`)
  await workbook.xlsx.write(res)
  res.end()
}

// GET /api/reports/hr/options — filter choices, already limited to the
// caller's authorized organizations.
async function getHrReportOptions(req, res, next) {
  try {
    const organizations = await authorizedOrganizations(req.user.userId, req.user.role)
    const orgIds = organizations.map((o) => o.id)
    const [departments, employees, sites, projects] = await Promise.all([
      prisma.department.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, name: true, organizationId: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, name: true, departmentId: true, organizationId: true, status: true, role: true }, orderBy: { name: "asc" } }),
      prisma.attendanceSite.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, name: true, organizationId: true, projectId: true }, orderBy: { name: "asc" } }),
      prisma.project.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true, name: true, organizationId: true }, orderBy: { name: "asc" } }),
    ])
    const current = orgIds.includes(req.user.organizationId) ? req.user.organizationId : orgIds[0] || null
    // "Marked by": anyone who can mark attendance for others.
    const markers = employees.filter((e) => e.role !== "EMPLOYEE").map(({ id, name, role, organizationId }) => ({ id, name, role, organizationId }))
    res.json({
      organizations, departments,
      employees: employees.map(({ role, ...e }) => e),
      sites, projects, markers,
      siteAdmins: markers.filter((m) => m.role === "SITE_ADMIN"),
      defaultOrganizationId: current, reportTypes: REPORT_TYPES,
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/reports/hr?type=…&from=…&to=…&organizationId=…&format=json|csv|xlsx
async function generateHrReport(req, res, next) {
  try {
    const q = req.query
    const type = String(q.type || "")
    if (!REPORT_TYPES.includes(type)) return badRequest(res, `type must be one of: ${REPORT_TYPES.join(", ")}`)
    const format = String(q.format || "json").toLowerCase()
    if (!["json", "csv", "xlsx"].includes(format)) return badRequest(res, "format must be json, csv or xlsx")

    const range = parseRange(q)
    if (range.error) return badRequest(res, range.error)
    if (DATE_REQUIRED.has(type) && (!range.from || !range.to)) return badRequest(res, "'Date From' and 'Date To' are required for this report")

    const allowed = await authorizedOrganizations(req.user.userId, req.user.role)
    const allowedIds = allowed.map((o) => o.id)
    let orgIds
    if (!q.organizationId || q.organizationId === "all") {
      orgIds = allowedIds
    } else if (allowedIds.includes(String(q.organizationId))) {
      orgIds = [String(q.organizationId)]
    } else {
      return res.status(403).json({ error: "You don't have access to that organization's reports" })
    }
    if (!orgIds.length) return res.status(403).json({ error: "No organization available for reporting" })

    const { columns, rows, summary } = await BUILDERS[type](orgIds, q, range)
    const clean = rows.map(({ _date, ...r }) => r)
    const orgLabel = orgIds.length === 1 ? allowed.find((o) => o.id === orgIds[0])?.name : `${orgIds.length} organizations`
    const meta = {
      Report: TITLES[type],
      Organization: orgLabel || "",
      "Date from": range.from ? fmtDate(range.from) : "—",
      "Date to": range.to ? fmtDate(range.to) : "—",
      "Generated at": new Date().toISOString(),
      "Total records": clean.length,
    }

    const byDate = DATE_GROUPED.has(type)
    if (format === "json") {
      const limit = byDate ? GROUPED_PREVIEW_LIMIT : PREVIEW_LIMIT
      return res.json({
        type, title: TITLES[type], meta, summary,
        groupBy: byDate ? "date" : null,
        columns: columns.map(([key, label]) => ({ key, label })),
        total: clean.length,
        rows: clean.slice(0, limit).map((r) => ({ ...r, _tone: rowTone(r) })),
        truncated: clean.length > limit,
      })
    }

    const filename = `${TITLES[type].replace(/[^A-Za-z]+/g, "_")}${range.from ? `_${fmtDate(range.from)}_${fmtDate(range.to)}` : ""}`
    if (format === "csv") {
      const lines = [columns.map(([, label]) => csvEscape(label)).join(","), ...clean.map((r) => columns.map(([key]) => csvEscape(r[key])).join(","))]
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`)
      return res.send("﻿" + lines.join("\r\n"))
    }
    return sendXlsx(res, filename, TITLES[type], columns, clean, meta, { byDate })
  } catch (err) {
    next(err)
  }
}

module.exports = { getHrReportOptions, generateHrReport, authorizedOrganizations }
