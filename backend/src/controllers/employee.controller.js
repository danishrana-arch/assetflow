const bcrypt = require("bcrypt")
const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES, ASSIGNABLE_ROLES, MAX_CEO_COUNT, EMPLOYEE_DIRECTORY_ROLES, hasModuleAccess, reportingManagerWhere, REPORTING_MANAGER_ROLES } = require("../utils/roles")
const { encryptField, decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { dateKeyInTimeZone } = require("../utils/timezone")
const { sortRows } = require("../utils/sort")
const { readSheet, mapHeaders, SheetError, ACCEPTED_LABEL } = require("../utils/sheet")
const {
  DETAIL_FIELDS,
  EMPLOYMENT_STATUSES,
  cleanText,
  parseDateInput,
  normalizeShiftTime,
  parseEmploymentStatus,
  detailFieldData,
  employmentData,
  decryptDetailFields,
  omitDetailFields,
} = require("../utils/employee-fields")

// Who may see/upload an employee's document pictures: the employee (view
// only), and ADMIN/CEO/HR. See employee-document.controller.js.
const DOCUMENT_ROLES = ["ADMIN", "CEO", "HR"]

function stripSensitive(user, canSeeSensitive) {
  const { password, cnic, bankAccountNumber, phone, address, personalEmail, fatherName, ...rest } = user
  if (!canSeeSensitive) return omitDetailFields(rest)
  return {
    ...rest,
    ...decryptDetailFields(rest),
    cnic: decryptField(cnic),
    bankAccountNumber: decryptField(bankAccountNumber),
    phone: decryptField(phone),
    address: decryptField(address),
    personalEmail: decryptField(personalEmail),
    fatherName: decryptField(fatherName),
  }
}

function stripForIT(user) {
  const { id, name, email, phone, role, status, photoUrl, designation, department, assignedAssets } = user
  // IT support legitimately needs a contact number, so this is one of the
  // few places a non-management role sees a decrypted PII field.
  return { id, name, email, phone: decryptField(phone), role, status, photoUrl, designation, department, assignedAssets }
}

async function listEmployees(req, res, next) {
  try {
    const { organizationId, companyId, role: requesterRole, departmentId: requesterDepartmentId } = req.user
    const { search, department, status, page, pageSize, includeCompanyManagers } = req.query

    // A DEPARTMENT_HEAD only ever sees their own department's roster,
    // regardless of what the client asks for — this is their "own
    // department" scoping, not a client-toggleable filter.
    const scopedDepartment =
      requesterRole === "DEPARTMENT_HEAD" ? requesterDepartmentId || "__none__" : department

    const useCompanyManagerPool = includeCompanyManagers === "true" || includeCompanyManagers === "1"
    // Reporting Manager dropdowns: only Admin / CEO / Department Head.
    const managersOnly = req.query.managersOnly === "true" || req.query.managersOnly === "1"
    const where = managersOnly
      ? reportingManagerWhere({ organizationId, companyId })
      : useCompanyManagerPool
      ? {
          OR: [
            { organizationId },
            { organizationId: companyId || organizationId, role: "CEO" },
          ],
          ...(scopedDepartment ? { departmentId: scopedDepartment } : {}),
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        }
      : {
          organizationId,
          ...(scopedDepartment ? { departmentId: scopedDepartment } : {}),
          ...(status ? { status } : {}),
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { email: { contains: search, mode: "insensitive" } },
                ],
              }
            : {}),
        }

    // Directory page filters/sorting (all optional; unknown values ignored).
    if (typeof where.status === "string" && !["ACTIVE", "ON_LEAVE", "LEFT_COMPANY"].includes(where.status)) delete where.status
    if (!managersOnly && req.query.role && ASSIGNABLE_ROLES.includes(req.query.role)) where.role = req.query.role
    if (req.query.workLocationType && ["OFFICE", "FIELD"].includes(req.query.workLocationType)) {
      where.workLocationType = req.query.workLocationType
    }
    // Interns tile: only people whose level is INTERN.
    if (req.query.level === "INTERN") where.seniorityLevel = "INTERN"
    // Sorted in JS (case-insensitive) — see utils/sort.js.
    const order = req.query.order === "desc" ? "desc" : "asc"
    const STATUS_ORDER = ["ACTIVE", "ON_LEAVE", "LEFT_COMPANY"]
    const SORT_VALUES = {
      name: (u) => u.name,
      manager: (u) => u.manager?.name,
      joiningDate: (u) => u.joiningDate?.getTime(),
      status: (u) => STATUS_ORDER.indexOf(u.status),
      department: (u) => u.department?.name,
    }
    const sortValue = SORT_VALUES[req.query.sort] || SORT_VALUES.name
    const include = {
      department: true,
      assignedAssets: true,
      manager: { select: { id: true, name: true } },
    }

    if (page) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25))
      // Stat cards: counts per status for the same filters, ignoring the status filter.
      const { status: _ignored, seniorityLevel: _level, ...countWhere } = where

      // One parallel round trip: org rosters are small, so load the filtered
      // set and sort/page it in memory.
      const [rows, ceoCount, statusGroups, internCount] = await Promise.all([
        prisma.user.findMany({ where, include }),
        prisma.user.count({ where: { organizationId, role: "CEO" } }),
        prisma.user.groupBy({ by: ["status"], where: { ...countWhere, ...(req.query.level === "INTERN" ? { seniorityLevel: "INTERN" } : {}) }, _count: { _all: true } }),
        // Interns who are still with the company (the tile ignores the level/status filters).
        prisma.user.count({ where: { ...countWhere, seniorityLevel: "INTERN", status: { not: "LEFT_COMPANY" } } }),
      ])
      const total = rows.length
      const employees = sortRows(rows, sortValue, order, (u) => u.name).slice((pageNum - 1) * size, pageNum * size)
      const statusCounts = { ACTIVE: 0, ON_LEAVE: 0, LEFT_COMPANY: 0 }
      for (const g of statusGroups) statusCounts[g.status] = g._count._all

      return res.json({
        data: requesterRole === "IT_MANAGER"
          ? employees.map(stripForIT)
          : employees.map(({ password, cnic, bankAccountNumber, ...e }) => omitDetailFields(e)),
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
        ceoCount,
        statusCounts,
        internCount,
      })
    }

    const employees = sortRows(await prisma.user.findMany({ where, include }), sortValue, order, (u) => u.name)

    // List views never include CNIC — only the single-employee view does,
    // and even then only for the employee themselves or management.
    res.json(
      requesterRole === "IT_MANAGER"
        ? employees.map(stripForIT)
        : employees.map(({ password, cnic, bankAccountNumber, ...e }) => omitDetailFields(e))
    )
  } catch (err) {
    next(err)
  }
}

async function getEmployee(req, res, next) {
  try {
    const { organizationId, userId, role, departmentId: requesterDepartmentId } = req.user
    const { id } = req.params

    // Employees can only view their own profile management roles can view anyone's.
    if (!EMPLOYEE_DIRECTORY_ROLES.includes(role) && userId !== id) {
      return res.status(403).json({ error: "You can only view your own profile" })
    }

    const employee = await prisma.user.findFirst({
      where: {
        id,
        organizationId,
        // DEPARTMENT_HEAD is scoped to their own department, same as the
        // directory list — but they can always still open their own profile.
        ...(role === "DEPARTMENT_HEAD" && id !== userId
          ? { departmentId: requesterDepartmentId || "__none__" }
          : {}),
      },
      include: {
        department: true,
        organization: true,
        manager: true,
        assignedAssets: true,
        attendanceRecords: { orderBy: { date: "desc" }, take: 90 },
        certifications: { orderBy: { createdAt: "asc" } },
        tickets: { orderBy: { createdAt: "desc" } },
        lifecycleEvents: { orderBy: { occurredAt: "desc" }, take: 20, include: { asset: true } },
        // The profile's Projects, Leave remaining and Recent payroll cards
        // read these — they were never loaded, so the cards were always empty.
        projectMemberships: {
          orderBy: { createdAt: "desc" },
          include: { project: { select: { id: true, name: true, status: true, deadline: true } } },
        },
        leaveApplications: {
          where: { status: "APPROVED" },
          orderBy: { startDate: "desc" },
          select: { id: true, startDate: true, endDate: true, type: true, status: true, isHalfDay: true },
        },
        payrollRecords: {
          orderBy: [{ year: "desc" }, { month: "desc" }],
          take: 5,
          select: { id: true, month: true, year: true, netPay: true, status: true },
        },
        // Metadata only — the file itself comes from /documents/:docId/file.
        documents: {
          orderBy: { createdAt: "asc" },
          select: { id: true, kind: true, label: true, fileName: true, mimeType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } },
        },
      },
    })

    if (!employee) return res.status(404).json({ error: "Employee not found" })
    // Pay details only for the employee themselves and the payroll module.
    if (!(userId === id || hasModuleAccess(role, "payroll"))) delete employee.payrollRecords

    // IT is intentionally asset-only. Never send payroll, salary, CNIC, DOB,
    // address, bank details, attendance, leave, or project data to an IT manager.
    if (role === "IT_MANAGER") {
      const {
        id: employeeId,
        name,
        email,
        phone,
        role: employeeRole,
        status,
        photoUrl,
        designation,
        department,
        manager,
        assignedAssets,
        tickets,
        lifecycleEvents,
        organization,
      } = employee

      return res.json({
        id: employeeId,
        name,
        email,
        phone,
        role: employeeRole,
        status,
        photoUrl,
        designation,
        department,
        manager: manager
          ? { id: manager.id, name: manager.name, email: manager.email, role: manager.role }
          : null,
        assignedAssets,
        tickets,
        lifecycleEvents,
        // Just the org name for the profile page's decorative banner — not
        // sensitive, and the redacted response otherwise omitted it
        // entirely, which made the banner fall back to "ASSETFLOW" for
        // every profile an IT_MANAGER opened.
        organization: organization ? { name: organization.name } : null,
      })
    }

    // Sensitive personal fields (CNIC/DOB/address/bank details) are only
    // meaningful to the employee themselves or someone in a management
    // role. CNIC and the bank account number are stored encrypted at rest
    // and only decrypted right here, for an authorized viewer.
    const isSelfOrManagement = MANAGEMENT_ROLES.includes(role) || userId === id
    const { password, cnic, dob, address, bankAccountNumber, phone, personalEmail, fatherName, ...rest } = employee
    const safe = isSelfOrManagement
      ? {
          ...rest,
          ...decryptDetailFields(rest),
          cnic: decryptField(cnic),
          dob,
          address: decryptField(address),
          bankAccountNumber: decryptField(bankAccountNumber),
          phone: decryptField(phone),
          personalEmail: decryptField(personalEmail),
          fatherName: decryptField(fatherName),
        }
      : omitDetailFields(rest)

    if (!(userId === id || DOCUMENT_ROLES.includes(role))) delete safe.documents

    // Certifications are visible to whoever has the certifications module
    // (ADMIN/CEO/HR) and to the employee themselves. They are not part of
    // other viewers' profile responses.
    if (!(hasModuleAccess(role, "certifications") || userId === id)) delete safe.certifications

    res.json(safe)
  } catch (err) {
    next(err)
  }
}

// GET /employees/:id/activity?month=YYYY-MM — one calendar month of an
// employee's attendance, approved leave, asset activity (events they acted
// on) and raised tickets, for the profile's month browser. Read-only; the
// same visibility rules as getEmployee: self or a directory role, org- and
// DEPARTMENT_HEAD-scoped, and IT_MANAGER never gets attendance or leave.
async function getEmployeeMonthActivity(req, res, next) {
  try {
    const { organizationId, userId, role, departmentId: requesterDepartmentId } = req.user
    const { id } = req.params

    if (!EMPLOYEE_DIRECTORY_ROLES.includes(role) && userId !== id) {
      return res.status(403).json({ error: "You can only view your own profile" })
    }
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(req.query.month || ""))
    if (!match) return res.status(400).json({ error: "month must be YYYY-MM" })
    const monthKey = `${match[1]}-${match[2]}`

    const employee = await prisma.user.findFirst({
      where: {
        id,
        organizationId,
        ...(role === "DEPARTMENT_HEAD" && id !== userId
          ? { departmentId: requesterDepartmentId || "__none__" }
          : {}),
      },
      select: { id: true, organization: { select: { timezone: true } } },
    })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const timeZone = employee.organization?.timezone || "UTC"
    const year = Number(match[1])
    const month = Number(match[2])
    // Attendance/leave dates are date-only (UTC midnight of the local day),
    // so plain UTC month bounds are exact for them.
    const start = new Date(Date.UTC(year, month - 1, 1))
    const end = new Date(Date.UTC(year, month, 1))
    // Timestamps are fetched with a one-day margin either side, then kept
    // only if they fall in this month in the org's timezone.
    const paddedStart = new Date(start.getTime() - 86400000)
    const paddedEnd = new Date(end.getTime() + 86400000)
    const inMonth = (date) => dateKeyInTimeZone(date, timeZone).slice(0, 7) === monthKey

    const isIT = role === "IT_MANAGER"
    const [attendanceRecords, leaves, lifecycleEvents, tickets] = await Promise.all([
      isIT
        ? []
        : prisma.attendanceRecord.findMany({
            where: { employeeId: id, date: { gte: start, lt: end } },
            orderBy: { date: "asc" },
            select: { id: true, date: true, status: true, checkInAt: true, checkOutAt: true, workingMinutes: true, locationMode: true, autoFlagged: true },
          }),
      isIT
        ? []
        : prisma.leaveApplication.findMany({
            where: { employeeId: id, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } },
            orderBy: { startDate: "asc" },
            select: { id: true, startDate: true, endDate: true, type: true, isHalfDay: true },
          }),
      prisma.lifecycleEvent.findMany({
        where: { actorId: id, occurredAt: { gte: paddedStart, lt: paddedEnd } },
        orderBy: { occurredAt: "desc" },
        select: { id: true, type: true, occurredAt: true, asset: { select: { id: true, name: true } } },
      }),
      prisma.ticket.findMany({
        where: { raisedById: id, createdAt: { gte: paddedStart, lt: paddedEnd } },
        orderBy: { createdAt: "desc" },
        select: { id: true, subject: true, status: true, priority: true, createdAt: true },
      }),
    ])

    res.json({
      month: monthKey,
      timezone: timeZone,
      attendanceRecords,
      leaves,
      lifecycleEvents: lifecycleEvents.filter((e) => inMonth(e.occurredAt)),
      tickets: tickets.filter((t) => inMonth(t.createdAt)),
    })
  } catch (err) {
    next(err)
  }
}

// Fields a management user may change on ANYONE (including their own
// record — "admin can edit any data, including their own").
const MANAGEMENT_EDITABLE_FIELDS = [
  "name",
  "email",
  "personalEmail",
  "phone",
  "fatherName",
  "education",
  "currentUniversity",
  "linkedinUrl",
  "shiftStart",
  "shiftEnd",
  "departmentId",
  "managerId",
  "status",
  "cnic",
  "dob",
  "address",
  "skill",
  "seniorityLevel",
  "baseSalary",
  "bankName",
  "bankAccountNumber",
  "designation",
  "joiningDate",
  "startDate",
  "workLocationType",
  ...DETAIL_FIELDS,
]
// Employment status decides leave eligibility, so only these roles set it.
const EMPLOYMENT_STATUS_EDITORS = ["ADMIN", "CEO", "HR"]

// Org policy: no salary below this (utils/payroll.js) — the floor, not a
// fixed scale.
const { MIN_BASE_SALARY } = require("../utils/payroll")
const { checkEmployeeCapacity } = require("../utils/billing")
const { recordProfileSalaryEdit } = require("./salary-revision.controller")

// Fields a non-management user may change on THEMSELVES ONLY.
const SELF_EDITABLE_FIELDS = ["phone", "email"]

async function updateEmployee(req, res, next) {
  try {
    const { organizationId, companyId, userId, role: requesterRole } = req.user
    const { id } = req.params
    const isManagementRequester = MANAGEMENT_ROLES.includes(requesterRole)
    const isSelf = userId === id

    const existing = await prisma.user.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Employee not found" })

    const requesterIsOwnerTier = ["ADMIN", "CEO"].includes(requesterRole)
    if (["ADMIN", "CEO"].includes(existing.role) && !requesterIsOwnerTier) {
      return res.status(403).json({ error: "Only an Admin or CEO can edit an Admin or CEO profile" })
    }
    // An ADMIN may edit a CEO's details, but not remove them by demoting
    // or deactivating them — that's the same as deleting, which only a CEO
    // may do to another CEO (see deleteEmployee).
    if (existing.role === "CEO" && requesterRole !== "CEO") {
      if (req.body.role !== undefined && req.body.role !== existing.role) {
        return res.status(403).json({ error: "Only a CEO can change a CEO's role" })
      }
      if (req.body.status !== undefined && req.body.status !== existing.status) {
        return res.status(403).json({ error: "Only a CEO can change a CEO's status" })
      }
    }

    // Bringing someone back from "Left Company" takes a seat on the plan.
    if (existing.status === "LEFT_COMPANY" && req.body.status && req.body.status !== "LEFT_COMPANY") {
      const blocked = await checkEmployeeCapacity(existing.organizationId, 1)
      if (blocked) return res.status(403).json(blocked)
    }

    const allowedFields = isManagementRequester
      ? MANAGEMENT_EDITABLE_FIELDS
      : isSelf
      ? SELF_EDITABLE_FIELDS
      : []

    if (allowedFields.length === 0) {
      return res.status(403).json({ error: "You can only edit your own profile" })
    }

    // Free-text fields: trimmed, and a blank value clears the field (null)
    // rather than storing "" — so a cleared field reads back as empty.
    const TEXT_FIELDS = ["name", "email", "education", "currentUniversity", "linkedinUrl", "skill", "bankName", "designation"]
    const clean = (value) => {
      if (value === null || value === undefined) return value
      const s = String(value).trim()
      return s === "" ? null : s
    }

    const data = {}
    for (const field of allowedFields) {
      if (req.body[field] === undefined) continue
      if (field === "name" || field === "email") {
        const value = clean(req.body[field])
        if (!value) return res.status(400).json({ error: field === "name" ? "Name is required" : "Company email is required" })
        if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.status(400).json({ error: "Invalid company email" })
        data[field] = value
      }
      else if (TEXT_FIELDS.includes(field)) data[field] = clean(req.body[field])
      else if (DETAIL_FIELDS.includes(field)) Object.assign(data, detailFieldData(req.body, [field]))
      else if (field === "dob") data.dob = req.body.dob ? new Date(req.body.dob) : null
      else if (field === "joiningDate") data.joiningDate = req.body.joiningDate ? new Date(req.body.joiningDate) : null
      else if (field === "startDate") {
        const value = parseDateInput(req.body.startDate)
        if (value === undefined) return res.status(400).json({ error: "Start date is not a valid date" })
        data.startDate = value
      }
      else if (field === "workLocationType") {
        if (!["OFFICE", "FIELD"].includes(req.body.workLocationType)) {
          return res.status(400).json({ error: "workLocationType must be OFFICE or FIELD" })
        }
        data.workLocationType = req.body.workLocationType
      }
      else if (["shiftStart", "shiftEnd"].includes(field)) {
        const value = req.body[field] || null
        if (value !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) {
          return res.status(400).json({ error: `${field} must use HH:mm format` })
        }
        data[field] = value
      }
      else if (field === "personalEmail") {
        // Validate the raw value BEFORE encrypting — the regex can't run
        // against ciphertext.
        const value = clean(req.body.personalEmail)
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          return res.status(400).json({ error: "Invalid personal email" })
        }
        data.personalEmail = value ? encryptField(value) : null
      }
      // Encrypted PII: a blank value clears it instead of storing "".
      else if (["cnic", "bankAccountNumber", "phone", "address", "fatherName"].includes(field)) {
        const value = clean(req.body[field])
        data[field] = value ? encryptField(value) : null
      }
      // Enum/foreign-key fields don't accept "" as a value — an empty
      // string from a "None" dropdown selection has to become null.
      else if (["seniorityLevel", "departmentId", "managerId"].includes(field)) {
        data[field] = req.body[field] || null
      } else if (field === "baseSalary") {
        const n = req.body.baseSalary === "" || req.body.baseSalary === null ? null : Number(req.body.baseSalary)
        if (n !== null && (Number.isNaN(n) || n < MIN_BASE_SALARY)) {
          return res.status(400).json({ error: `baseSalary must be at least PKR ${MIN_BASE_SALARY.toLocaleString()}` })
        }
        data.baseSalary = n
      } else data[field] = req.body[field]
    }

    // Employment status / permanent date (ADMIN/CEO/HR). Only applied when
    // something actually changes — the edit form always sends both back.
    if (req.body.employmentStatus !== undefined || req.body.permanentDate !== undefined) {
      const status = req.body.employmentStatus === undefined ? undefined : req.body.employmentStatus
      if (status !== undefined && !EMPLOYMENT_STATUSES.includes(status)) {
        return res.status(400).json({ error: `employmentStatus must be one of: ${EMPLOYMENT_STATUSES.join(", ")}` })
      }
      const permanentDate = req.body.permanentDate === undefined ? undefined : parseDateInput(req.body.permanentDate || null)
      if (req.body.permanentDate !== undefined && permanentDate === undefined) {
        return res.status(400).json({ error: "Permanent date is not a valid date" })
      }
      const next = employmentData({ employmentStatus: status, permanentDate }, existing)
      const sameDate = (a, b) => (a ? new Date(a).toISOString().slice(0, 10) : null) === (b ? new Date(b).toISOString().slice(0, 10) : null)
      const changed = next.employmentStatus !== existing.employmentStatus || !sameDate(next.permanentDate, existing.permanentDate)
      if (changed) {
        if (!EMPLOYMENT_STATUS_EDITORS.includes(requesterRole)) {
          return res.status(403).json({ error: "Only an Admin, CEO or HR can change employment status" })
        }
        Object.assign(data, next)
      }
    }

    if (data.linkedinUrl !== undefined && data.linkedinUrl) {
      try {
        const url = new URL(String(data.linkedinUrl))
        if (!["http:", "https:"].includes(url.protocol) || !url.hostname.toLowerCase().includes("linkedin.com")) throw new Error()
      } catch {
        return res.status(400).json({ error: "LinkedIn must be a valid LinkedIn URL" })
      }
    }

    if (data.email !== undefined) {
      // User.email is unique across the whole database, not per org — an
      // org-only check let a cross-org duplicate through to a 500.
      const emailTaken = await prisma.user.findFirst({
        where: { email: { equals: data.email, mode: "insensitive" }, NOT: { id } },
      })
      if (emailTaken) return res.status(409).json({ error: "That email is already in use" })
    }

    // ADMIN/CEO may change any role. HR may change the role of a non-ADMIN/
    // CEO employee to a non-owner role (never to ADMIN/CEO, never their own),
    // so HR can't escalate anyone — including themselves — into owner tier.
    // ADMIN/CEO targets are already blocked for HR above.
    // Only enforced when the role actually changes — the profile edit form
    // always sends the current role back unchanged.
    if (req.body.role !== undefined && req.body.role !== existing.role) {
      const hrCanAssign = requesterRole === "HR" && !isSelf && !["ADMIN", "CEO"].includes(req.body.role)
      if (!requesterIsOwnerTier && !hrCanAssign) {
        return res.status(403).json({
          error: requesterRole === "HR"
            ? (isSelf ? "You can't change your own role" : "HR can't assign the Admin or CEO role")
            : "Only an Admin, CEO or HR can change roles",
        })
      }
      if (!ASSIGNABLE_ROLES.includes(req.body.role)) {
        return res.status(400).json({ error: `role must be one of: ${ASSIGNABLE_ROLES.join(", ")}` })
      }
      // The CEO is the org's top authority (payroll approval/payout, the
      // disbursement account) — capped at 2 so that authority stays
      // concentrated, per org policy.
      if (req.body.role === "CEO" && existing.role !== "CEO") {
        const ceoCount = await prisma.user.count({ where: { organization: { companyId }, role: "CEO" } })
        if (ceoCount >= MAX_CEO_COUNT) {
          return res.status(400).json({ error: `An organization can have at most ${MAX_CEO_COUNT} CEOs` })
        }
      }
      data.role = req.body.role
    }

    // Only checked when the manager actually changes, so re-saving a profile
    // whose existing manager predates the role rule still works.
    if (data.managerId && data.managerId !== existing.managerId) {
      if (data.managerId === id) return res.status(400).json({ error: "An employee cannot report to themselves" })
      const manager = await prisma.user.findFirst({
        where: { id: data.managerId, ...reportingManagerWhere({ organizationId, companyId }) },
        select: { id: true },
      })
      if (!manager) return res.status(400).json({ error: "Reporting Manager must be an Admin, CEO or Department Head" })
    }

    const updated = await prisma.user.update({ where: { id }, data })

    // Keep the salary history complete when the field is edited directly.
    if (data.baseSalary !== undefined) {
      const org = await prisma.organization.findUnique({ where: { id: existing.organizationId }, select: { timezone: true } })
      await recordProfileSalaryEdit({ organizationId: existing.organizationId, employeeId: id, previousSalary: existing.baseSalary, newSalary: data.baseSalary, userId, timeZone: org?.timezone })
    }

    if (data.employmentStatus && data.employmentStatus !== existing.employmentStatus) {
      logAudit({
        organizationId,
        actorId: userId,
        action: "employee.employment_status_changed",
        targetType: "User",
        targetId: id,
        note: `${existing.employmentStatus} -> ${data.employmentStatus}${data.permanentDate ? ` (from ${data.permanentDate.toISOString().slice(0, 10)})` : ""}`,
      })
    }

    if (data.role && data.role !== existing.role) {
      logAudit({
        organizationId,
        actorId: userId,
        action: "employee.role_changed",
        targetType: "User",
        targetId: id,
        note: `${existing.role} -> ${data.role}`,
      })
    }

    res.json(stripSensitive(updated, isManagementRequester || isSelf))
  } catch (err) {
    next(err)
  }
}

// Only the organization owner (ADMIN) can remove an employee outright —
// management roles (CEO/Sales Head/HR) can view and edit, not delete.
async function deleteEmployee(req, res, next) {
  try {
    const { organizationId, userId, role: requesterRole } = req.user
    const { id } = req.params

    if (id === userId) {
      return res.status(400).json({ error: "You can't remove your own account" })
    }

    const existing = await prisma.user.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Employee not found" })

    // CEO accounts are protected from ADMIN/other management roles. Only a
    // CEO may remove another CEO. A CEO is also allowed to remove any other
    // account in the organization, including the original ADMIN owner.
    if (existing.role === "CEO" && requesterRole !== "CEO") {
      return res.status(403).json({ error: "Only a CEO can remove a CEO account" })
    }

    if (requesterRole !== "ADMIN" && requesterRole !== "CEO") {
      return res.status(403).json({ error: "Only an ADMIN or CEO can remove employees" })
    }

    const assignedAssets = await prisma.asset.findMany({ where: { assignedToId: id } })

    await prisma.$transaction([
      ...assignedAssets.map((asset) =>
        prisma.lifecycleEvent.create({
          data: {
            assetId: asset.id,
            type: "UNASSIGNED",
            actorId: userId,
            note: `Unassigned — ${existing.name} <${existing.email}> was removed from the organization`,
          },
        })
      ),
      ...assignedAssets.map((asset) =>
        prisma.asset.update({
          where: { id: asset.id },
          data: { status: "AVAILABLE", assignedToId: null },
        })
      ),
      // EmployeeFormInvitation (dead, never-wired feature) still has a
      // RESTRICT FK to its creator — clear those rows so they can't block
      // the delete. Everything else referencing User either cascades or is
      // SET NULL at the DB level, so the row (and its email) is fully freed
      // and the same email can be invited again afterwards.
      prisma.employeeFormInvitation.deleteMany({ where: { createdById: id } }),
      prisma.user.delete({ where: { id } }),
    ])

    logAudit({ organizationId, actorId: userId, action: "employee.deleted", targetType: "User", targetId: id, note: `${existing.name} <${existing.email}> removed by ${requesterRole}` })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

// Every employee field the import understands — the same columns manual add
// and the profile edit form write. Order = template column order.
const IMPORT_COLUMNS = [
  "name", "email", "personalEmail", "phone", "fatherName", "address", "cnic", "passportNumber", "civilNumber",
  "nationality", "agentName", "dob", "joiningDate", "startDate", "employmentStatus", "permanentDate",
  "education", "currentUniversity", "linkedinUrl", "department", "role", "reportingManager", "designation",
  "skill", "seniorityLevel", "workLocationType", "shiftStart", "shiftEnd",
  "emergencyContactName", "emergencyContactRelationship", "emergencyContactPhone", "emergencyContactAltPhone",
  "emergencyContactAddress", "emergencyContactNotes", "baseSalary", "bankName", "bankAccountNumber",
]
// Human-readable template headers (each also accepted on import).
const IMPORT_HEADERS = {
  name: "Name", email: "Company Email", personalEmail: "Personal Email", phone: "Phone Number",
  fatherName: "Father Name", address: "Address", cnic: "CNIC", passportNumber: "Passport Number",
  civilNumber: "Civil Number", nationality: "Nationality", agentName: "Agent Name", dob: "Date of Birth",
  joiningDate: "Joining Date", startDate: "Start Date", employmentStatus: "Employment Status",
  permanentDate: "Permanent Date", education: "Education", currentUniversity: "Current University",
  linkedinUrl: "LinkedIn", department: "Department", role: "Role", reportingManager: "Reporting Manager",
  designation: "Designation", skill: "Skill", seniorityLevel: "Level", workLocationType: "Employee Type",
  shiftStart: "Shift Start", shiftEnd: "Shift End", emergencyContactName: "Emergency Contact Name",
  emergencyContactRelationship: "Emergency Contact Relationship", emergencyContactPhone: "Emergency Contact Phone",
  emergencyContactAltPhone: "Emergency Contact Alternate Phone", emergencyContactAddress: "Emergency Contact Address",
  emergencyContactNotes: "Emergency Contact Notes", baseSalary: "Base Salary", bankName: "Bank Name",
  bankAccountNumber: "Bank Account Number",
}
const VALID_LEVELS = ["INTERN", "JUNIOR", "SENIOR", "LEAD"]
const EMPLOYEE_IMPORT_ALIASES = {
  name: ["full name", "employee name", "employee", "name of employee"],
  email: ["email address", "e-mail", "work email", "company email", "official email", "office email"],
  personalEmail: ["personal email address", "private email"],
  phone: ["phone number", "mobile", "mobile number", "contact", "contact number", "cell", "whatsapp"],
  fatherName: ["father's name", "father", "father name"],
  currentUniversity: ["university", "current university", "institute", "college"],
  linkedinUrl: ["linkedin", "linkedin profile", "linkedin url"],
  shiftStart: ["shift start time", "start time"],
  shiftEnd: ["shift end time", "end time"],
  department: ["dept", "team"],
  cnic: ["cnic number", "national id", "id card", "nic"],
  passportNumber: ["passport", "passport no", "passport #"],
  civilNumber: ["civil id", "civil no", "civil id number", "civil id no"],
  nationality: ["citizenship", "country"],
  agentName: ["agent", "recruitment agent", "recruiting agent"],
  dob: ["date of birth", "birth date", "birthday"],
  joiningDate: ["joining date", "date of joining", "joined", "joined on", "doj"],
  startDate: ["start date", "campaign start date", "started on", "operation start date"],
  employmentStatus: ["employment status", "employment type", "permanent / probation"],
  permanentDate: ["permanent date", "permanent from", "confirmation date", "date of confirmation"],
  address: ["residence", "home address", "address line"],
  skill: ["skills", "expertise"],
  seniorityLevel: ["level", "seniority", "grade"],
  role: ["user role", "access role"],
  reportingManager: ["reporting manager", "manager", "line manager", "reports to", "supervisor", "manager email"],
  designation: ["title", "job title", "position"],
  workLocationType: ["employee type", "work location", "work location type"],
  emergencyContactName: ["emergency contact", "emergency contact name", "ecp", "ecp name"],
  emergencyContactRelationship: ["emergency contact relationship", "relationship", "ecp relationship", "emergency relationship"],
  emergencyContactPhone: ["emergency contact phone", "emergency phone", "ecp phone", "emergency contact number"],
  emergencyContactAltPhone: ["emergency contact alternate phone", "emergency alternate phone", "ecp alternate phone", "alternate phone", "emergency contact alt phone"],
  emergencyContactAddress: ["emergency contact address", "ecp address", "emergency address"],
  emergencyContactNotes: ["emergency contact notes", "ecp notes", "emergency notes"],
  baseSalary: ["salary", "base salary", "monthly salary"],
  bankName: ["bank"],
  bankAccountNumber: ["account number", "bank account", "iban"],
}

// Bulk-create employees from a spreadsheet (header row in any order, names
// matched loosely — see IMPORT_HEADERS / EMPLOYEE_IMPORT_ALIASES). Only
// name + email are required, same as single add. Each row becomes an
// ordinary User with the same fields the profile shows; a value that can't
// be read (bad date, unknown level…) is left blank and reported as a
// warning instead of dropping the whole row. Every created account gets a
// random temp password, same as single-add.
async function importEmployees(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: `Upload a spreadsheet (${ACCEPTED_LABEL}) under the 'file' field` })

    const { organizationId, companyId, role: requesterRole } = req.user
    let rows
    try {
      rows = await readSheet(req.file)
    } catch (err) {
      if (err instanceof SheetError) return res.status(400).json({ error: err.message })
      throw err
    }
    if (rows.length < 2) return res.status(400).json({ error: "The sheet needs a header row plus at least one employee row" })

    const aliases = Object.fromEntries(IMPORT_COLUMNS.map((col) => [col, [IMPORT_HEADERS[col], ...(EMPLOYEE_IMPORT_ALIASES[col] || [])]]))
    const headerMap = mapHeaders(rows[0], IMPORT_COLUMNS, aliases)

    if (headerMap.name === undefined || headerMap.email === undefined) {
      return res.status(400).json({ error: "The sheet must have at least a 'name' and an 'email' column" })
    }

    const [departments, managerPool] = await Promise.all([
      prisma.department.findMany({ where: { organizationId } }),
      // Same pool the Reporting Manager dropdown offers: Admin / CEO /
      // Department Head (utils/roles.js reportingManagerWhere).
      headerMap.reportingManager === undefined
        ? []
        : prisma.user.findMany({
            where: reportingManagerWhere({ organizationId, companyId }),
            select: { id: true, name: true, email: true },
          }),
    ])
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]))
    const created = []
    const skipped = []
    const warnings = []
    // Managers can also be rows earlier in the same sheet.
    const managers = [...managerPool]

    const valueAt = (row, key) => headerMap[key] === undefined ? "" : String(row[headerMap[key]] || "").trim()

    for (let index = 1; index < rows.length; index++) {
      const rowNumber = index + 1
      const row = rows[index]
      const name = valueAt(row, "name")
      const email = valueAt(row, "email")
      if (!name && !email) continue
      const warn = (reason) => warnings.push({ row: rowNumber, reason })

      if (!name || !email) {
        skipped.push({ row: rowNumber, reason: "Missing name or email" })
        continue
      }
      // Plan employee limit — checked per row so a sheet fills the remaining
      // seats and the rest are reported, instead of overshooting.
      if (await checkEmployeeCapacity(organizationId, 1)) {
        skipped.push({ row: rowNumber, reason: "Employee limit reached for your plan — upgrade to add more" })
        continue
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skipped.push({ row: rowNumber, reason: `Invalid email (${email})` })
        continue
      }

      // User.email is globally unique, so check across every org (case-insensitive).
      const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } })
      if (existing) {
        skipped.push({ row: rowNumber, reason: `Email already exists (${email})` })
        continue
      }

      let assignedRole = "EMPLOYEE"
      if (headerMap.role !== undefined) {
        const raw = valueAt(row, "role").toUpperCase().replace(/\s+/g, "_")
        if (raw && ASSIGNABLE_ROLES.includes(raw)) {
          // Same rule as single add (inviteEmployee): ADMIN/CEO any role,
          // HR any non-owner role.
          const hrCanAssign = requesterRole === "HR" && !["ADMIN", "CEO"].includes(raw)
          if (raw !== "EMPLOYEE" && !["ADMIN", "CEO"].includes(requesterRole) && !hrCanAssign) {
            warn("Only an Admin or CEO can import Admin/CEO accounts — imported as EMPLOYEE")
          } else if (raw === "CEO") {
            const ceoCount = await prisma.user.count({ where: { organization: { companyId }, role: "CEO" } })
            if (ceoCount >= MAX_CEO_COUNT) {
              skipped.push({ row: rowNumber, reason: `The organization already has ${MAX_CEO_COUNT} CEOs` })
              continue
            }
            assignedRole = raw
          } else {
            assignedRole = raw
          }
        } else if (raw) {
          warn(`Unknown role "${valueAt(row, "role")}" — imported as EMPLOYEE`)
        }
      }

      const dateField = (key, label) => {
        const raw = valueAt(row, key)
        const value = parseDateInput(raw)
        if (value === undefined) {
          warn(`${label} "${raw}" isn't a date (use YYYY-MM-DD or DD/MM/YYYY) — left blank`)
          return null
        }
        return value
      }
      const shiftField = (key, label) => {
        const raw = valueAt(row, key)
        const value = normalizeShiftTime(raw)
        if (value === undefined) {
          warn(`${label} "${raw}" isn't a time (use HH:mm, e.g. 09:00) — left blank`)
          return null
        }
        return value
      }

      const departmentName = valueAt(row, "department")
      const departmentId = departmentName ? deptByName.get(departmentName.toLowerCase()) || null : null
      if (departmentName && !departmentId) warn(`Department "${departmentName}" not found — left blank`)

      const seniorityRaw = valueAt(row, "seniorityLevel").toUpperCase()
      if (seniorityRaw && !VALID_LEVELS.includes(seniorityRaw)) warn(`Level "${valueAt(row, "seniorityLevel")}" must be Intern, Junior, Senior or Lead — left blank`)

      const workLocationRaw = valueAt(row, "workLocationType").toUpperCase()
      const workLocationType = !workLocationRaw ? "OFFICE" : workLocationRaw.startsWith("FIELD") || workLocationRaw.includes("REMOTE") ? "FIELD" : "OFFICE"

      const statusRaw = valueAt(row, "employmentStatus")
      let employmentStatus = parseEmploymentStatus(statusRaw)
      if (employmentStatus === undefined) {
        warn(`Employment status "${statusRaw}" must be Permanent or Probation — imported as Probation`)
        employmentStatus = null
      }
      const permanentDate = dateField("permanentDate", "Permanent date")

      let managerId = null
      const managerRaw = valueAt(row, "reportingManager")
      if (managerRaw) {
        const key = managerRaw.toLowerCase()
        const matches = managers.filter((m) => m.email.toLowerCase() === key || m.name.toLowerCase() === key)
        if (matches.length === 1) managerId = matches[0].id
        else warn(matches.length ? `Reporting manager "${managerRaw}" matches several people — use their email; left blank` : `Reporting manager "${managerRaw}" not found among Admins, CEOs and Department Heads — left blank`)
      }

      let baseSalary = null
      const salaryRaw = valueAt(row, "baseSalary").replace(/[,\s]|pkr|rs\.?/gi, "")
      if (salaryRaw) {
        const n = Number(salaryRaw)
        if (Number.isNaN(n) || n < MIN_BASE_SALARY) warn(`Base salary "${valueAt(row, "baseSalary")}" must be at least PKR ${MIN_BASE_SALARY.toLocaleString()} — left blank`)
        else baseSalary = n
      }

      const linkedinRaw = valueAt(row, "linkedinUrl")
      let linkedinUrl = linkedinRaw || null
      if (linkedinUrl) {
        try {
          const url = new URL(/^https?:\/\//i.test(linkedinUrl) ? linkedinUrl : `https://${linkedinUrl}`)
          if (!url.hostname.toLowerCase().includes("linkedin.com")) throw new Error()
          linkedinUrl = url.toString()
        } catch {
          warn(`LinkedIn "${linkedinRaw}" isn't a LinkedIn URL — left blank`)
          linkedinUrl = null
        }
      }

      const details = {}
      for (const field of DETAIL_FIELDS) details[field] = valueAt(row, field)

      const tempPassword = Math.random().toString(36).slice(2, 10)
      const hashed = await bcrypt.hash(tempPassword, 10)

      try {
        const user = await prisma.user.create({
          data: {
            organizationId,
            name,
            email,
            password: hashed,
            role: assignedRole,
            phone: encryptField(valueAt(row, "phone") || null),
            personalEmail: encryptField(valueAt(row, "personalEmail") || null),
            fatherName: encryptField(valueAt(row, "fatherName") || null),
            education: cleanText(valueAt(row, "education")),
            currentUniversity: cleanText(valueAt(row, "currentUniversity")),
            linkedinUrl,
            shiftStart: shiftField("shiftStart", "Shift start"),
            shiftEnd: shiftField("shiftEnd", "Shift end"),
            cnic: encryptField(valueAt(row, "cnic") || null),
            dob: dateField("dob", "Date of birth"),
            joiningDate: dateField("joiningDate", "Joining date"),
            startDate: dateField("startDate", "Start date"),
            address: encryptField(valueAt(row, "address") || null),
            skill: cleanText(valueAt(row, "skill")),
            designation: cleanText(valueAt(row, "designation")),
            seniorityLevel: VALID_LEVELS.includes(seniorityRaw) ? seniorityRaw : null,
            workLocationType,
            departmentId,
            managerId,
            baseSalary,
            bankName: cleanText(valueAt(row, "bankName")),
            bankAccountNumber: encryptField(valueAt(row, "bankAccountNumber") || null),
            ...detailFieldData(details),
            ...employmentData({ employmentStatus, permanentDate }),
          },
        })
        if (REPORTING_MANAGER_ROLES.includes(user.role)) managers.push({ id: user.id, name: user.name, email: user.email })
        created.push({ row: rowNumber, name: user.name, email: user.email, tempPassword })
      } catch (err) {
        skipped.push({ row: rowNumber, reason: "Could not create row (check for duplicate/invalid data)" })
      }
    }

    res.json({ createdCount: created.length, skippedCount: skipped.length, created, skipped, warnings })
  } catch (err) {
    next(err)
  }
}

// A starter CSV with every column importEmployees understands. Only Name
// and Company Email are required.
async function importTemplate(req, res, next) {
  try {
    const example = {
      name: "Jane Doe", email: "jane@example.com", personalEmail: "jane.personal@example.com", phone: "0300-1234567",
      fatherName: "John Doe", address: "Lahore, Punjab", cnic: "35202-1234567-1", passportNumber: "AB1234567",
      civilNumber: "290010112345", nationality: "Pakistani", agentName: "Ali Recruitment", dob: "1995-01-20",
      joiningDate: "2026-01-15", startDate: "2026-02-01", employmentStatus: "Probation", permanentDate: "",
      education: "BS Computer Science", currentUniversity: "University of Punjab",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe", department: "Engineering", role: "EMPLOYEE",
      reportingManager: "manager@example.com", designation: "Customer Support Agent", skill: "Customer Support",
      seniorityLevel: "JUNIOR", workLocationType: "Office", shiftStart: "09:00", shiftEnd: "17:00",
      emergencyContactName: "Sara Doe", emergencyContactRelationship: "Sister", emergencyContactPhone: "0301-7654321",
      emergencyContactAltPhone: "042-1234567", emergencyContactAddress: "Lahore, Punjab", emergencyContactNotes: "",
      baseSalary: "50000", bankName: "HBL", bankAccountNumber: "",
    }
    const csvCell = (value) => {
      const text = String(value ?? "")
      return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const header = IMPORT_COLUMNS.map((col) => csvCell(IMPORT_HEADERS[col])).join(",")
    const exampleRow = IMPORT_COLUMNS.map((col) => csvCell(example[col])).join(",")

    res.setHeader("Content-Type", "text/csv; charset=utf-8")
    res.setHeader("Content-Disposition", "attachment; filename=employee-import-template.csv")
    res.send(`﻿${header}\n${exampleRow}\n`)
  } catch (err) {
    next(err)
  }
}

// Profile picture. Stored inline in User.photoUrl as a small data URL (the
// browser crops/resizes it to a square JPEG before upload), so every list
// that already returns photoUrl shows it with no extra request. Anyone may
// set their own; ADMIN/CEO/HR may set someone else's in their org, but an
// ADMIN/CEO's picture only by an ADMIN/CEO (same rule as editing them).
const PHOTO_MAX_BYTES = 200 * 1024
const PHOTO_EDITORS = ["ADMIN", "CEO", "HR"]
const PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/

function photoBytesMatch(kind, buf) {
  if (kind === "jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
  if (kind === "png") return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (kind === "webp") return buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP"
  return false
}

async function updateEmployeePhoto(req, res, next) {
  try {
    const { organizationId, userId, role: requesterRole } = req.user
    const { id } = req.params
    const isSelf = userId === id

    // Your own picture lives on your home record, even while viewing another company.
    const select = { id: true, role: true, organizationId: true }
    const existing = isSelf
      ? await prisma.user.findUnique({ where: { id }, select })
      : await prisma.user.findFirst({ where: { id, organizationId }, select })
    if (!existing) return res.status(404).json({ error: "Employee not found" })

    if (!isSelf) {
      if (!PHOTO_EDITORS.includes(requesterRole)) {
        return res.status(403).json({ error: "You can only change your own profile picture" })
      }
      if (["ADMIN", "CEO"].includes(existing.role) && !["ADMIN", "CEO"].includes(requesterRole)) {
        return res.status(403).json({ error: "Only an Admin or CEO can change an Admin or CEO's picture" })
      }
    }

    let photoUrl = null
    const { photo } = req.body || {}
    if (photo !== null && photo !== undefined && photo !== "") {
      const match = typeof photo === "string" ? PHOTO_PATTERN.exec(photo) : null
      if (!match) return res.status(400).json({ error: "Picture must be a JPG, PNG or WEBP image" })
      const buf = Buffer.from(match[2], "base64")
      if (buf.length > PHOTO_MAX_BYTES) return res.status(400).json({ error: "Picture is too large (max 200 KB after resizing)" })
      if (!photoBytesMatch(match[1], buf)) return res.status(400).json({ error: "That file isn't a valid image" })
      photoUrl = photo
    }

    await prisma.user.update({ where: { id }, data: { photoUrl } })
    logAudit({
      organizationId: existing.organizationId,
      actorId: userId,
      action: photoUrl ? "employee.photo_updated" : "employee.photo_removed",
      targetType: "User",
      targetId: id,
    })
    res.json({ id, photoUrl })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  listEmployees,
  getEmployee,
  getEmployeeMonthActivity,
  updateEmployee,
  deleteEmployee,
  importEmployees,
  importTemplate,
  updateEmployeePhoto,
}
