const prisma = require("../lib/prisma")
const { decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { toNumber, round2, computePayrollTotals, approvedExpenseTotal } = require("../utils/payroll")
const { streamPayslipPdf } = require("../utils/payslip-pdf")
const { hasModuleAccess } = require("../utils/roles")

// Counts how many of an (inclusive) date range's days fall within the
// given month, so a multi-day unpaid-leave request that only partly
// overlaps the payroll month still gets deducted correctly for just the
// days that actually happened in that month.
function daysInMonthOverlap(start, end, monthStart, monthEnd) {
  const from = start < monthStart ? monthStart : start
  const to = end < monthEnd ? end : new Date(monthEnd.getTime() - 1)
  if (to < from) return 0
  return Math.round((to - from) / 86400000) + 1
}

// POST /api/payroll/generate  { month, year }
// Creates one DRAFT record per ACTIVE employee with a baseSalary set, for
// employees who don't already have a record for that month; an existing
// DRAFT has its attendance-derived lines refreshed, submitted/paid ones
// are left untouched (safe to re-run). Deductions: each ABSENT attendance
// day and each unpaid-leave day is a percentage of the employee's base
// salary per day (not
// a flat amount), banded by salary so it stays proportional — plus the
// org's configured lateDeductionAmount (default 500 PKR) per day marked
// LATE. Bonus is always manual, applied afterward via updatePayroll.
//
// Unpaid-leave daily deduction rate, by monthly base salary:
//   < 70,000            -> 2.7%
//   70,000 - 119,999.99 -> 3.3%
//   120,000 - 179,999.99 -> 3.8%
//   >= 180,000          -> 4.5%
// A half-day unpaid leave deducts half of that day's amount.
function unpaidLeaveDailyRate(baseSalary) {
  if (baseSalary >= 180000) return 0.045
  if (baseSalary >= 120000) return 0.038
  if (baseSalary >= 70000) return 0.033
  return 0.027
}

const PAYSLIP_EMPLOYEE_SELECT = { id: true, name: true, baseSalary: true, bankName: true, bankAccountNumber: true }

// The attendance/leave-derived part of a payslip for one employee/month:
// late days, absent days (attendance marked ABSENT — no check-in, or set
// by an admin), unpaid leave, and approved expense claims. Absent days and
// full unpaid-leave days are deducted at the same per-day rate (a half-day
// unpaid leave at half of it); an unpaid-leave day is recorded as LEAVE in
// attendance, never ABSENT, so the two never overlap.
async function computeAttendanceLines({ employeeId, base, month, year, lateRate }) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 1)) // exclusive

  const [lateDays, absentDays] = await Promise.all([
    prisma.attendanceRecord.count({ where: { employeeId, status: "LATE", date: { gte: monthStart, lt: monthEnd } } }),
    prisma.attendanceRecord.count({ where: { employeeId, status: "ABSENT", date: { gte: monthStart, lt: monthEnd } } }),
  ])

  const unpaidLeaves = await prisma.leaveApplication.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      type: "UNPAID",
      startDate: { lt: monthEnd },
      endDate: { gte: monthStart },
    },
    select: { startDate: true, endDate: true, isHalfDay: true },
  })

  let fullUnpaidDays = 0
  let halfUnpaidDays = 0
  for (const leave of unpaidLeaves) {
    if (leave.isHalfDay) {
      halfUnpaidDays += 1 // half-day leave is always a single day by definition
    } else {
      fullUnpaidDays += daysInMonthOverlap(leave.startDate, leave.endDate, monthStart, monthEnd)
    }
  }

  const perDayDeduction = base * unpaidLeaveDailyRate(base)
  return {
    absentDays,
    unpaidLeaveDays: fullUnpaidDays,
    halfDayLeaveDays: halfUnpaidDays,
    lateDays,
    absentDeduction: round2((absentDays + fullUnpaidDays) * perDayDeduction + halfUnpaidDays * (perDayDeduction / 2)),
    lateDeduction: round2(lateDays * lateRate),
    expenseReimbursement: await approvedExpenseTotal(prisma, employeeId, month, year),
  }
}

// Builds a new DRAFT payslip's data for one employee/month.
async function buildPayslipData({ emp, month, year, organizationId, userId, lateRate }) {
  const base = toNumber(emp.baseSalary)
  const lines = await computeAttendanceLines({ employeeId: emp.id, base, month, year, lateRate })
  const breakdown = { baseSalary: base, bonus: 0, tax: 0, otherDeduction: 0, ...lines }
  return {
    organizationId,
    employeeId: emp.id,
    month,
    year,
    ...breakdown,
    ...computePayrollTotals(breakdown),
    status: "DRAFT",
    generatedById: userId,
    bankName: emp.bankName,
    bankAccountNumber: emp.bankAccountNumber, // already encrypted at rest on User — copied as-is
  }
}

async function orgLateRate(organizationId) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } })
  return toNumber(organization?.lateDeductionAmount) || 500
}

async function generatePayroll(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)

    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ error: "Valid month (1-12) and year are required" })
    }

    const lateRate = await orgLateRate(organizationId)

    const employees = await prisma.user.findMany({
      where: { organizationId, status: "ACTIVE", baseSalary: { not: null } },
      select: PAYSLIP_EMPLOYEE_SELECT,
    })

    let created = 0
    let refreshed = 0
    let skipped = 0

    for (const emp of employees) {
      const existing = await prisma.payrollRecord.findUnique({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
      })
      if (existing) {
        if (existing.status !== "DRAFT") {
          skipped += 1
          continue
        }
        // Re-running Generate refreshes a DRAFT's attendance-derived lines
        // (absent/late/unpaid leave/expenses) so absences marked since it
        // was first generated are deducted; manual bonus/tax/other and
        // termination amounts are kept.
        const lines = await computeAttendanceLines({ employeeId: emp.id, base: toNumber(existing.baseSalary), month, year, lateRate })
        await prisma.payrollRecord.update({
          where: { id: existing.id },
          data: { ...lines, ...computePayrollTotals({ ...existing, ...lines }) },
        })
        refreshed += 1
        continue
      }

      await prisma.payrollRecord.create({
        data: await buildPayslipData({ emp, month, year, organizationId, userId, lateRate }),
      })
      created += 1
    }

    res.status(201).json({
      created,
      refreshed,
      skipped,
      eligibleEmployees: employees.length,
      message:
        employees.length === 0
          ? "No active employees have a base salary set. Add one from an employee's profile first."
          : undefined,
    })
  } catch (err) {
    next(err)
  }
}

function maskAccountNumber(decrypted) {
  if (!decrypted) return null
  const digits = String(decrypted)
  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : "••••"
}

// GET /api/payroll?month=&year=
// The bank account number is only ever shown in full to a CEO — since
// only a CEO's account actually pays anyone, they're the one who needs it
// to send the money. Other management roles (who can generate/review
// payroll but not disburse it) see it masked.
async function listPayroll(req, res, next) {
  try {
    const { organizationId, role } = req.user
    const month = Number(req.query.month)
    const year = Number(req.query.year)
    if (!month || !year) return res.status(400).json({ error: "month and year query params are required" })

    const records = await prisma.payrollRecord.findMany({
      where: { organizationId, month, year },
      include: {
        employee: { select: { id: true, name: true, email: true, photoUrl: true, department: { select: { name: true } } } },
      },
      orderBy: { employee: { name: "asc" } },
    })

    const isCeo = role === "CEO"
    res.json(
      records.map((r) => ({
        ...r,
        bankAccountNumber: isCeo ? decryptField(r.bankAccountNumber) : maskAccountNumber(decryptField(r.bankAccountNumber)),
      }))
    )
  } catch (err) {
    next(err)
  }
}

// GET /api/payroll/summary?year=
// Aggregates a full year's payroll records for the reporting page: totals
// by month (for a trend chart), totals by department, and a status
// breakdown (draft/pending/paid counts). No per-employee bank details are
// included, so this is safe to show without the CEO-only account-number
// restriction that applies to listPayroll.
async function getPayrollSummary(req, res, next) {
  try {
    const { organizationId } = req.user
    const year = Number(req.query.year) || new Date().getFullYear()

    const records = await prisma.payrollRecord.findMany({
      where: { organizationId, year },
      select: {
        month: true,
        baseSalary: true,
        bonus: true,
        deductions: true,
        netPay: true,
        status: true,
        employee: { select: { department: { select: { name: true } } } },
      },
    })

    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, baseSalary: 0, bonus: 0, deductions: 0, netPay: 0, count: 0,
    }))
    const byDepartment = new Map()
    const byStatus = { DRAFT: 0, PENDING_APPROVAL: 0, PAID: 0 }
    let totalNetPay = 0

    for (const r of records) {
      const bucket = byMonth[r.month - 1]
      bucket.baseSalary += toNumber(r.baseSalary)
      bucket.bonus += toNumber(r.bonus)
      bucket.deductions += toNumber(r.deductions)
      bucket.netPay += toNumber(r.netPay)
      bucket.count += 1
      totalNetPay += toNumber(r.netPay)
      byStatus[r.status] = (byStatus[r.status] || 0) + 1

      const deptName = r.employee?.department?.name || "Unassigned"
      const dept = byDepartment.get(deptName) || { department: deptName, netPay: 0, count: 0 }
      dept.netPay += toNumber(r.netPay)
      dept.count += 1
      byDepartment.set(deptName, dept)
    }

    const round = (n) => Math.round(n * 100) / 100

    res.json({
      year,
      totalNetPay: round(totalNetPay),
      byMonth: byMonth.map((m) => ({
        ...m, baseSalary: round(m.baseSalary), bonus: round(m.bonus), deductions: round(m.deductions), netPay: round(m.netPay),
      })),
      byDepartment: Array.from(byDepartment.values())
        .sort((a, b) => b.netPay - a.netPay)
        .map((d) => ({ ...d, netPay: round(d.netPay) })),
      byStatus,
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/payroll/me — the logged-in employee's own payslips.
async function myPayroll(req, res, next) {
  try {
    const { userId } = req.user
    const records = await prisma.payrollRecord.findMany({
      where: { employeeId: userId },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    })
    res.json(records.map((r) => ({ ...r, bankAccountNumber: decryptField(r.bankAccountNumber) })))
  } catch (err) {
    next(err)
  }
}

// Amount lines an admin may edit by hand on a DRAFT payslip. Absent/late
// come from attendance, expenseReimbursement from approved claims, and tax
// from taxPercent, so they're recomputed rather than typed in.
const EDITABLE_AMOUNTS = ["bonus", "otherDeduction", "terminationSettlement", "terminationDeduction"]
const MIN_BONUS = 500

function cleanText(value, max) {
  if (value === undefined) return undefined
  const text = String(value ?? "").trim()
  return text ? text.slice(0, max) : null
}

// GET /api/payroll/:id/pdf — a printable payslip. Your own payslip is
// always downloadable; anyone else's needs the payroll module and the same
// organization.
async function downloadPayslipPdf(req, res, next) {
  try {
    const { userId, organizationId, role } = req.user
    const record = await prisma.payrollRecord.findUnique({ where: { id: req.params.id } })
    const isOwn = record && record.employeeId === userId
    if (!record || (!isOwn && !(hasModuleAccess(role, "payroll") && record.organizationId === organizationId))) {
      return res.status(404).json({ error: "Payslip not found" })
    }

    const [employee, organization] = await Promise.all([
      prisma.user.findUnique({
        where: { id: record.employeeId },
        select: { name: true, email: true, designation: true, joiningDate: true, department: { select: { name: true } } },
      }),
      prisma.organization.findUnique({
        where: { id: record.organizationId },
        select: { name: true, primaryColor: true, timezone: true },
      }),
    ])

    const safeName = (employee?.name || "employee").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
    const filename = `payslip-${safeName}-${record.year}-${String(record.month).padStart(2, "0")}.pdf`
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
    streamPayslipPdf(res, {
      record,
      employee: employee || { name: "-", email: "-" },
      organization: organization || { name: "Company", primaryColor: null, timezone: "UTC" },
      bankAccount: decryptField(record.bankAccountNumber),
    })
  } catch (err) {
    next(err)
  }
}

// PATCH /api/payroll/:id
//   { bonus, taxPercent, otherDeduction, note,
//     terminationDate, terminationSettlement, terminationDeduction, terminationNote }
// Only DRAFT records can be edited — a PAID payslip is a fixed record.
// Sending terminationDate: null clears the termination section entirely.
async function updatePayroll(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const existing = await prisma.payrollRecord.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Payroll record not found" })
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "Only a DRAFT payslip can be edited — it's already been submitted or paid" })
    }

    const data = {}
    for (const key of EDITABLE_AMOUNTS) {
      if (req.body[key] === undefined) continue
      const value = req.body[key] === "" || req.body[key] === null ? 0 : Number(req.body[key])
      if (Number.isNaN(value) || value < 0) {
        return res.status(400).json({ error: `${key} must be a non-negative number` })
      }
      data[key] = round2(value)
    }

    if (data.bonus !== undefined && data.bonus > 0 && data.bonus < MIN_BONUS) {
      return res.status(400).json({ error: `Bonus must be at least PKR ${MIN_BONUS} (or 0 for no bonus)` })
    }

    if (req.body.taxPercent !== undefined) {
      const pct = req.body.taxPercent === "" || req.body.taxPercent === null ? 0 : Number(req.body.taxPercent)
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        return res.status(400).json({ error: "Tax percentage must be between 0 and 100" })
      }
      data.taxPercent = round2(pct)
      data.tax = round2((toNumber(existing.baseSalary) * data.taxPercent) / 100)
    }

    const note = cleanText(req.body.note, 1000)
    if (note !== undefined) data.note = note

    if (req.body.terminationDate !== undefined) {
      if (req.body.terminationDate === null || req.body.terminationDate === "") {
        Object.assign(data, { terminationDate: null, terminationSettlement: 0, terminationDeduction: 0, terminationNote: null })
      } else {
        const date = new Date(req.body.terminationDate)
        if (Number.isNaN(date.getTime())) return res.status(400).json({ error: "terminationDate is not a valid date" })
        data.terminationDate = date
      }
    }
    const terminationNote = cleanText(req.body.terminationNote, 1000)
    if (terminationNote !== undefined && data.terminationDate !== null) data.terminationNote = terminationNote

    const hasTermination = (data.terminationDate !== undefined ? data.terminationDate : existing.terminationDate) !== null
    if (!hasTermination && (toNumber(data.terminationSettlement) > 0 || toNumber(data.terminationDeduction) > 0)) {
      return res.status(400).json({ error: "Set a termination date before adding termination amounts" })
    }

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { ...data, ...computePayrollTotals({ ...existing, ...data }) },
    })

    if (data.terminationDate && !existing.terminationDate) {
      logAudit({ organizationId, actorId: userId, action: "payroll.termination_added", targetType: "PayrollRecord", targetId: id, note: `${existing.month}/${existing.year}` })
    }
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/tax  { month, year, taxPercent }
// Applies one tax percentage to every DRAFT payslip of the month
// (tax = basic pay x %). Submitted/paid payslips are left untouched; a
// single payslip can still be overridden afterward from its Edit panel.
async function applyTaxToMonth(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    const pct = Number(req.body.taxPercent)
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ error: "Valid month (1-12) and year are required" })
    }
    if (req.body.taxPercent === "" || Number.isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ error: "Tax percentage must be between 0 and 100" })
    }
    const taxPercent = round2(pct)

    const drafts = await prisma.payrollRecord.findMany({ where: { organizationId, month, year, status: "DRAFT" } })
    if (!drafts.length) return res.status(400).json({ error: "No draft payslips for this month — generate payroll first" })

    await prisma.$transaction(
      drafts.map((r) => {
        const tax = round2((toNumber(r.baseSalary) * taxPercent) / 100)
        return prisma.payrollRecord.update({
          where: { id: r.id },
          data: { taxPercent, tax, ...computePayrollTotals({ ...r, tax }) },
        })
      })
    )

    logAudit({ organizationId, actorId: userId, action: "payroll.tax_applied", note: `${month}/${year} — ${taxPercent}% on ${drafts.length} payslip(s)` })
    res.json({ updated: drafts.length, taxPercent })
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/employee  { employeeId, month, year }
// Creates one employee's DRAFT payslip for a month, whatever their status.
// Bulk generate only covers ACTIVE employees, so this is how an employee
// who has already been marked "Left Company" still gets their final
// (termination) payslip.
async function createEmployeePayslip(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    const { employeeId } = req.body
    if (!employeeId || !month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ error: "employeeId, a valid month (1-12) and year are required" })
    }

    const emp = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: PAYSLIP_EMPLOYEE_SELECT })
    if (!emp) return res.status(404).json({ error: "Employee not found" })
    if (emp.baseSalary === null) {
      return res.status(400).json({ error: `${emp.name} has no base salary set. Add one from their profile first.` })
    }

    const existing = await prisma.payrollRecord.findUnique({
      where: { employeeId_month_year: { employeeId, month, year } },
    })
    if (existing) return res.status(409).json({ error: `${emp.name} already has a payslip for this month` })

    const lateRate = await orgLateRate(organizationId)
    const record = await prisma.payrollRecord.create({
      data: await buildPayslipData({ emp, month, year, organizationId, userId, lateRate }),
    })
    logAudit({ organizationId, actorId: userId, action: "payroll.payslip_created", targetType: "PayrollRecord", targetId: record.id, note: `${emp.name} — ${month}/${year}` })
    res.status(201).json(record)
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/:id/mark-paid
// POST /api/payroll/:id/mark-paid — single-record override, kept for
// fixing up one payslip after the fact. The normal flow is the bulk
// approve below.
async function markPaid(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const existing = await prisma.payrollRecord.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Payroll record not found" })
    if (existing.status === "PAID") return res.status(400).json({ error: "Already marked paid" })

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { status: "PAID", paidAt: new Date(), approvedById: userId, approvedAt: new Date() },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// DELETE /api/payroll/:id — undo an accidental generate. PAID payslips are
// permanent records and can never be deleted, single or bulk.
async function deletePayroll(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params

    const existing = await prisma.payrollRecord.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Payroll record not found" })
    if (existing.status === "PAID") return res.status(400).json({ error: "Paid payslips cannot be deleted" })

    await prisma.payrollRecord.delete({ where: { id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/submit  { month, year }
// An Admin/Finance Manager's final step after generating and reviewing a
// month's batch: sends every DRAFT record for that month to the CEO for
// approval. A CEO doesn't need to "submit to themselves".
async function submitForApproval(req, res, next) {
  try {
    const { organizationId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    if (!month || !year) return res.status(400).json({ error: "month and year are required" })

    const result = await prisma.payrollRecord.updateMany({
      where: { organizationId, month, year, status: "DRAFT" },
      data: { status: "PENDING_APPROVAL" },
    })
    if (result.count === 0) {
      return res.status(400).json({ error: "No draft payslips for that month to submit — generate payroll first" })
    }

    logAudit({ organizationId, actorId: req.user.userId, action: "payroll.submitted", note: `${month}/${year} — ${result.count} payslip(s) sent for CEO approval` })
    res.json({ submitted: result.count })
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/approve  { month, year }
// The CEO's sign-off: every PENDING_APPROVAL record for that month is
// approved and paid out in one action — "delivered to every account" in
// a single click rather than one payslip at a time. CEO-only, since
// salaries are paid from the CEO's own account.
async function approveAndPayAll(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    if (!month || !year) return res.status(400).json({ error: "month and year are required" })

    const now = new Date()
    const result = await prisma.payrollRecord.updateMany({
      where: { organizationId, month, year, status: "PENDING_APPROVAL" },
      data: { status: "PAID", approvedById: userId, approvedAt: now, paidAt: now },
    })
    if (result.count === 0) {
      return res.status(400).json({ error: "Nothing is pending approval for that month" })
    }

    logAudit({ organizationId, actorId: userId, action: "payroll.approved_and_paid", note: `${month}/${year} — ${result.count} payslip(s) delivered` })
    res.json({ paid: result.count })
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/reject  { month, year, note }
// Sends a submitted batch back to the admin for revision instead of
// approving it. CEO-only.
async function rejectBatch(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    if (!month || !year) return res.status(400).json({ error: "month and year are required" })

    const result = await prisma.payrollRecord.updateMany({
      where: { organizationId, month, year, status: "PENDING_APPROVAL" },
      data: { status: "DRAFT", note: req.body.note ? String(req.body.note).slice(0, 1000) : undefined },
    })
    if (result.count === 0) {
      return res.status(400).json({ error: "Nothing is pending approval for that month" })
    }

    logAudit({ organizationId, actorId: userId, action: "payroll.rejected", note: `${month}/${year} — ${result.count} payslip(s) sent back to draft` })
    res.json({ returnedToDraft: result.count })
  } catch (err) {
    next(err)
  }
}

// DELETE /api/payroll/bulk  { month, year }
// The CEO's "delete all in one" — clears an entire month's batch (DRAFT or
// PENDING_APPROVAL only; PAID records are permanent, same rule as the
// single-record delete). CEO-only.
async function deleteAllForMonth(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)
    if (!month || !year) return res.status(400).json({ error: "month and year are required" })

    const result = await prisma.payrollRecord.deleteMany({
      where: { organizationId, month, year, status: { not: "PAID" } },
    })

    logAudit({ organizationId, actorId: userId, action: "payroll.bulk_deleted", note: `${month}/${year} — ${result.count} payslip(s)` })
    res.json({ deleted: result.count })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  generatePayroll,
  listPayroll,
  getPayrollSummary,
  myPayroll,
  updatePayroll,
  createEmployeePayslip,
  applyTaxToMonth,
  downloadPayslipPdf,
  markPaid,
  deletePayroll,
  submitForApproval,
  approveAndPayAll,
  rejectBatch,
  deleteAllForMonth,
}
