const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { createNotification } = require("../utils/notifications")
const { toNumber, round2, computePayrollTotals, MIN_BASE_SALARY } = require("../utils/payroll")
const { hasModuleAccess } = require("../utils/roles")
const { dateKeyInTimeZone } = require("../utils/timezone")

// Salary increments / decrements (Payroll page and Employee Profile), with a
// permanent history in SalaryRevision. A revision changes User.baseSalary and
// every DRAFT payslip from its effective month on (basic pay, tax at the
// payslip's tax %, totals); each payslip change is also logged as a
// FIELD_EDIT PayrollAdjustment so it shows in that payslip's history.
// Submitted/paid payslips are never touched.

const REVISE_ROLES = ["ADMIN", "CEO", "HR"]
const MAX_SALARY = 10000000
const MAX_MONTHS_BACK = 12

const REVISION_INCLUDE = {
  employee: { select: { id: true, name: true, photoUrl: true } },
  createdBy: { select: { id: true, name: true, role: true } },
}

function serialize(r) {
  return {
    id: r.id,
    employeeId: r.employeeId,
    employee: r.employee ? { id: r.employee.id, name: r.employee.name, photoUrl: r.employee.photoUrl } : null,
    type: r.type,
    previousSalary: r.previousSalary === null ? null : toNumber(r.previousSalary),
    newSalary: toNumber(r.newSalary),
    changeAmount: toNumber(r.changeAmount),
    changePercent: r.changePercent === null ? null : toNumber(r.changePercent),
    effectiveMonth: r.effectiveMonth,
    effectiveYear: r.effectiveYear,
    reason: r.reason,
    source: r.source,
    payslipsUpdated: r.payslipsUpdated,
    createdBy: r.createdBy ? { id: r.createdBy.id, name: r.createdBy.name, role: r.createdBy.role } : null,
    createdAt: r.createdAt,
  }
}

// GET /payroll/salary-revisions?employeeId=&limit=
// Payroll-module roles (ADMIN/CEO/HR) see the org; anyone else only their own.
async function listSalaryRevisions(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : null
    const canSeeOrg = hasModuleAccess(role, "payroll")
    if (!canSeeOrg && employeeId !== userId) return res.status(403).json({ error: "You can only see your own salary history" })

    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const where = employeeId === userId && !canSeeOrg ? { employeeId: userId } : { organizationId, ...(employeeId ? { employeeId } : {}) }
    const rows = await prisma.salaryRevision.findMany({ where, include: REVISION_INCLUDE, orderBy: { createdAt: "desc" }, take: limit })
    res.json(rows.map(serialize))
  } catch (err) {
    next(err)
  }
}

function currentMonthIn(timeZone) {
  const [y, m] = dateKeyInTimeZone(new Date(), timeZone || "Asia/Karachi").split("-").map(Number)
  return { month: m, year: y }
}

// POST /payroll/salary-revisions
// { employeeId, direction: INCREMENT|DECREMENT, mode: AMOUNT|PERCENT, value,
//   effectiveMonth, effectiveYear, reason }
async function createSalaryRevision(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!REVISE_ROLES.includes(role)) return res.status(403).json({ error: "Only an Admin, CEO or HR can change salaries" })

    const { employeeId, direction, mode } = req.body
    if (!["INCREMENT", "DECREMENT"].includes(direction)) return res.status(400).json({ error: "Choose increment or decrement" })
    if (!["AMOUNT", "PERCENT"].includes(mode)) return res.status(400).json({ error: "Choose an amount or a percentage" })
    const value = Number(req.body.value)
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({ error: "Enter a value greater than 0" })
    if (mode === "PERCENT" && value > (direction === "DECREMENT" ? 100 : 500)) {
      return res.status(400).json({ error: direction === "DECREMENT" ? "A decrement can't be more than 100%" : "An increment can't be more than 500%" })
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : ""
    if (reason.length < 3) return res.status(400).json({ error: "A reason is required" })
    if (reason.length > 500) return res.status(400).json({ error: "Reason is too long (max 500 characters)" })

    const employee = await prisma.user.findFirst({
      where: { id: String(employeeId || ""), organizationId },
      select: { id: true, name: true, role: true, baseSalary: true, organization: { select: { timezone: true } } },
    })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    if (employee.id === userId) return res.status(403).json({ error: "You can't change your own salary" })
    if (role === "HR" && ["ADMIN", "CEO"].includes(employee.role)) {
      return res.status(403).json({ error: "HR can't change an Admin's or CEO's salary" })
    }
    if (employee.baseSalary === null) return res.status(400).json({ error: "Set a base salary on the employee's profile first" })

    // Effective month: this month or up to 12 months back (never the future —
    // the new salary takes effect on the employee immediately).
    const now = currentMonthIn(employee.organization?.timezone)
    const effectiveMonth = Number(req.body.effectiveMonth) || now.month
    const effectiveYear = Number(req.body.effectiveYear) || now.year
    if (!Number.isInteger(effectiveMonth) || effectiveMonth < 1 || effectiveMonth > 12 || !Number.isInteger(effectiveYear)) {
      return res.status(400).json({ error: "Effective month is not valid" })
    }
    const index = (y, m) => y * 12 + (m - 1)
    const diff = index(now.year, now.month) - index(effectiveYear, effectiveMonth)
    if (diff < 0) return res.status(400).json({ error: "The effective month can't be in the future" })
    if (diff > MAX_MONTHS_BACK) return res.status(400).json({ error: `The effective month can be at most ${MAX_MONTHS_BACK} months back` })

    const previousSalary = toNumber(employee.baseSalary)
    const change = round2(mode === "AMOUNT" ? value : (previousSalary * value) / 100)
    if (change <= 0) return res.status(400).json({ error: "The change works out to PKR 0" })
    const newSalary = round2(direction === "INCREMENT" ? previousSalary + change : previousSalary - change)
    if (newSalary < MIN_BASE_SALARY) {
      return res.status(400).json({ error: `Salary can't go below PKR ${MIN_BASE_SALARY.toLocaleString()} (would be PKR ${newSalary.toLocaleString()})` })
    }
    if (newSalary > MAX_SALARY) return res.status(400).json({ error: `Salary can't be more than PKR ${MAX_SALARY.toLocaleString()}` })

    const fromMonth = { OR: [{ year: { gt: effectiveYear } }, { year: effectiveYear, month: { gte: effectiveMonth } }] }
    const label = direction === "INCREMENT" ? "Salary increment" : "Salary decrement"

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: employee.id }, data: { baseSalary: newSalary } })

      const payslips = await tx.payrollRecord.findMany({ where: { employeeId: employee.id, ...fromMonth } })
      const drafts = payslips.filter((p) => p.status === "DRAFT")
      for (const p of drafts) {
        const tax = round2((newSalary * toNumber(p.taxPercent)) / 100)
        const totals = computePayrollTotals({ ...p, baseSalary: newSalary, tax })
        await tx.payrollRecord.update({ where: { id: p.id }, data: { baseSalary: newSalary, tax, ...totals } })
        await tx.payrollAdjustment.create({
          data: {
            organizationId: p.organizationId,
            payrollRecordId: p.id,
            employeeId: employee.id,
            type: "FIELD_EDIT",
            line: "baseSalary",
            amount: round2(totals.netPay - toNumber(p.netPay)),
            originalValue: toNumber(p.baseSalary),
            newValue: newSalary,
            previousNetPay: toNumber(p.netPay),
            newNetPay: totals.netPay,
            reason: `${label}: ${reason}`,
            payslipStatus: p.status,
            createdById: userId,
          },
        })
      }

      const revision = await tx.salaryRevision.create({
        data: {
          organizationId,
          employeeId: employee.id,
          type: direction,
          previousSalary,
          newSalary,
          changeAmount: direction === "INCREMENT" ? change : -change,
          changePercent: mode === "PERCENT" ? round2(value) : null,
          effectiveMonth,
          effectiveYear,
          reason,
          source: "PAYROLL",
          payslipsUpdated: drafts.length,
          createdById: userId,
        },
        include: REVISION_INCLUDE,
      })
      return { revision, payslipsUpdated: drafts.length, payslipsLocked: payslips.length - drafts.length }
    })

    const sign = direction === "INCREMENT" ? "+" : "−"
    logAudit({
      organizationId,
      actorId: userId,
      action: direction === "INCREMENT" ? "salary.increment" : "salary.decrement",
      targetType: "User",
      targetId: employee.id,
      note: `${employee.name}: PKR ${previousSalary.toLocaleString()} -> ${newSalary.toLocaleString()} (${sign}${change.toLocaleString()}) from ${effectiveMonth}/${effectiveYear} — ${reason}`,
    })
    createNotification({
      organizationId,
      recipientId: employee.id,
      createdById: userId,
      type: "INFO",
      title: label,
      message: `Your base salary is now PKR ${newSalary.toLocaleString()} / month (${sign}PKR ${change.toLocaleString()}), from ${effectiveMonth}/${effectiveYear}.`,
      link: "/payroll/me",
    }).catch(() => {})

    res.status(201).json({ revision: serialize(result.revision), payslipsUpdated: result.payslipsUpdated, payslipsLocked: result.payslipsLocked })
  } catch (err) {
    next(err)
  }
}

// Called by updateEmployee when the salary field is edited directly on the
// profile, so the history also covers changes made outside this flow.
async function recordProfileSalaryEdit({ organizationId, employeeId, previousSalary, newSalary, userId, timeZone }) {
  if (newSalary === null || newSalary === undefined) return
  const prev = previousSalary === null || previousSalary === undefined ? null : toNumber(previousSalary)
  const next = toNumber(newSalary)
  if (prev === next) return
  const now = currentMonthIn(timeZone)
  try {
    await prisma.salaryRevision.create({
      data: {
        organizationId,
        employeeId,
        type: prev === null ? "SET" : next > prev ? "INCREMENT" : "DECREMENT",
        previousSalary: prev,
        newSalary: next,
        changeAmount: round2(next - (prev || 0)),
        effectiveMonth: now.month,
        effectiveYear: now.year,
        reason: "Salary edited on the employee profile",
        source: "PROFILE_EDIT",
        createdById: userId,
      },
    })
  } catch (err) {
    console.error("[salary-revision] failed to record profile edit", err)
  }
}

module.exports = { listSalaryRevisions, createSalaryRevision, recordProfileSalaryEdit }
