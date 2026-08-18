const prisma = require("../lib/prisma")
const { decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")

function toNumber(decimal) {
  return decimal === null || decimal === undefined ? 0 : Number(decimal)
}

function computeNetPay({ baseSalary, bonus, deductions }) {
  const net = toNumber(baseSalary) + toNumber(bonus) - toNumber(deductions)
  return Math.max(0, Math.round(net * 100) / 100)
}

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
// employees who don't already have a record for that month. Existing
// records are left untouched (idempotent — safe to re-run). Deductions:
// unpaid leave is a percentage of the employee's base salary per day (not
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

async function generatePayroll(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const month = Number(req.body.month)
    const year = Number(req.body.year)

    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ error: "Valid month (1-12) and year are required" })
    }

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } })
    const lateDeduction = toNumber(organization?.lateDeductionAmount) || 500

    const employees = await prisma.user.findMany({
      where: { organizationId, status: "ACTIVE", baseSalary: { not: null } },
      select: { id: true, name: true, baseSalary: true, bankName: true, bankAccountNumber: true },
    })

    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(year, month, 1)) // exclusive

    let created = 0
    let skipped = 0

    for (const emp of employees) {
      const existing = await prisma.payrollRecord.findUnique({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
      })
      if (existing) {
        skipped += 1
        continue
      }

      const lateDays = await prisma.attendanceRecord.count({
        where: { employeeId: emp.id, status: "LATE", date: { gte: monthStart, lt: monthEnd } },
      })

      const unpaidLeaves = await prisma.leaveApplication.findMany({
        where: {
          employeeId: emp.id,
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

      const base = toNumber(emp.baseSalary)
      const dailyRate = unpaidLeaveDailyRate(base)
      const perDayDeduction = base * dailyRate
      const leaveDeduction = fullUnpaidDays * perDayDeduction + halfUnpaidDays * (perDayDeduction / 2)
      const lateDeductionTotal = lateDays * lateDeduction
      const totalDeductions = Math.round((leaveDeduction + lateDeductionTotal) * 100) / 100

      await prisma.payrollRecord.create({
        data: {
          organizationId,
          employeeId: emp.id,
          month,
          year,
          baseSalary: base,
          bonus: 0,
          deductions: totalDeductions,
          unpaidLeaveDays: fullUnpaidDays,
          halfDayLeaveDays: halfUnpaidDays,
          lateDays,
          netPay: computeNetPay({ baseSalary: base, bonus: 0, deductions: totalDeductions }),
          status: "DRAFT",
          generatedById: userId,
          bankName: emp.bankName,
          bankAccountNumber: emp.bankAccountNumber, // already encrypted at rest on User — copied as-is
        },
      })
      created += 1
    }

    res.status(201).json({
      created,
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

// PATCH /api/payroll/:id  { bonus, deductions, note }
// Only DRAFT records can be edited — a PAID payslip is a fixed record.
async function updatePayroll(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params
    const { bonus, deductions, note } = req.body

    const existing = await prisma.payrollRecord.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Payroll record not found" })
    if (existing.status !== "DRAFT") {
      return res.status(400).json({ error: "Only a DRAFT payslip can be edited — it's already been submitted or paid" })
    }

    const nextBonus = bonus !== undefined ? Number(bonus) : toNumber(existing.bonus)
    const nextDeductions = deductions !== undefined ? Number(deductions) : toNumber(existing.deductions)

    if (Number.isNaN(nextBonus) || Number.isNaN(nextDeductions) || nextBonus < 0 || nextDeductions < 0) {
      return res.status(400).json({ error: "bonus and deductions must be non-negative numbers" })
    }

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: {
        bonus: nextBonus,
        deductions: nextDeductions,
        note: note !== undefined ? note : existing.note,
        netPay: computeNetPay({ baseSalary: existing.baseSalary, bonus: nextBonus, deductions: nextDeductions }),
      },
    })

    res.json(updated)
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
// An admin/owner's final step after generating and reviewing a month's
// batch: sends every DRAFT record for that month to the CEO for approval.
// ADMIN-only — a CEO doesn't need to "submit to themselves".
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
  myPayroll,
  updatePayroll,
  markPaid,
  deletePayroll,
  submitForApproval,
  approveAndPayAll,
  rejectBatch,
  deleteAllForMonth,
}
