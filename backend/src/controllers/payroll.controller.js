const prisma = require("../lib/prisma")
const { decryptField } = require("../utils/crypto")
const { logAudit } = require("../utils/audit")
const { createNotification } = require("../utils/notifications")
const { toNumber, round2, computePayrollTotals, approvedExpenseTotal, performanceBonusTotal } = require("../utils/payroll")
const { streamPayslipPdf } = require("../utils/payslip-pdf")
const { hasModuleAccess } = require("../utils/roles")
const { isScheduledWorkday } = require("../utils/work-schedule")
const { dateKeyInTimeZone } = require("../utils/timezone")
const { latePenaltiesForYear } = require("../utils/leave-policy")

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
// are left untouched (safe to re-run). Deductions: the org's absent fine
// (Organization.absentFineAmount, set on the Attendance page → Fines) per
// ABSENT day and per unpaid-leave day (half of it for a half-day), plus
// lateDeductionAmount per LATE day. No absent fine set = no absent/unpaid
// deduction. Bonus is always manual, applied afterward via updatePayroll.

const PAYSLIP_EMPLOYEE_SELECT = { id: true, name: true, baseSalary: true, bankName: true, bankAccountNumber: true }

// The attendance/leave-derived part of a payslip for one employee/month:
// late days, absent days (attendance marked ABSENT — no check-in, or set
// by an admin), unpaid leave, and approved expense claims. Absent days and
// full unpaid-leave days are deducted at the org's absent fine per day (a
// half-day unpaid leave at half of it); an unpaid-leave day is recorded as
// LEAVE in attendance, never ABSENT, so the two never overlap.
// (`base` is kept in the signature for callers; the deduction no longer
// depends on salary.)
async function computeAttendanceLines({ employeeId, base, month, year, lateRate }) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1))
  const monthEnd = new Date(Date.UTC(year, month, 1)) // exclusive

  // Days whose automatic fine HR/ADMIN/CEO waived on the Attendance page
  // aren't counted; manual fines added there become fineDeduction.
  // HALF_DAY / EARLY_GOING days come straight from the attendance engine's
  // stored result (services/attendance-engine.js); their half-day deduction
  // replaces that day's late fine.
  const [lateRecords, absentRecords, fines, shortDays] = await Promise.all([
    prisma.attendanceRecord.findMany({ where: { employeeId, status: "LATE", date: { gte: monthStart, lt: monthEnd } }, select: { date: true } }),
    prisma.attendanceRecord.findMany({ where: { employeeId, status: "ABSENT", date: { gte: monthStart, lt: monthEnd } }, select: { date: true } }),
    prisma.attendanceFine.findMany({ where: { employeeId, date: { gte: monthStart, lt: monthEnd } }, select: { date: true, waived: true, extraAmount: true } }),
    prisma.attendanceRecord.findMany({
      where: { employeeId, status: { in: ["PRESENT", "LATE"] }, dayType: { in: ["HALF_DAY", "EARLY_GOING"] }, date: { gte: monthStart, lt: monthEnd } },
      select: { date: true, dayType: true, deductionDays: true, earlyGoingFine: true },
    }),
  ])
  const waivedKeys = new Set(fines.filter((f) => f.waived).map((f) => f.date.toISOString().slice(0, 10)))
  const notWaived = (r) => !waivedKeys.has(r.date.toISOString().slice(0, 10))
  const shortDayKeys = new Set(shortDays.map((r) => r.date.toISOString().slice(0, 10)))
  const lateDays = lateRecords.filter(notWaived).filter((r) => !shortDayKeys.has(r.date.toISOString().slice(0, 10))).length
  const absentDays = absentRecords.filter(notWaived).length
  const fineDeduction = round2(fines.reduce((s, f) => s + toNumber(f.extraAmount), 0))
  const chargedShortDays = shortDays.filter(notWaived)
  const halfDayDeductionDays = chargedShortDays.reduce((s, r) => s + toNumber(r.deductionDays), 0)

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

  // The only per-day rate: the org's absent fine (Attendance page → Fines).
  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: {
      id: true, organizationId: true, joiningDate: true, startDate: true, employmentStatus: true, permanentDate: true,
      organization: { select: { absentFineAmount: true, halfDayDeductionPercent: true, annualLeaveEntitlement: true, sickLeaveAllowance: true, casualLeaveAllowance: true } },
    },
  })
  const perDay = toNumber(employee?.organization?.absentFineAmount)

  // Company late-arrival rules (utils/late-rules.js): e.g. 3 lates = half
  // day. Late arrivals a rule uses aren't also charged the per-late fine
  // (when the rule says so); the part not taken from leave is charged here.
  let finedLateDays = lateDays
  let latePenalty = { salaryDays: 0, salaryAmount: 0, leaveDays: 0 }
  if (employee) {
    const { months } = await latePenaltiesForYear({ organizationId: employee.organizationId, employee, org: employee.organization, year })
    const m = months[month]
    if (m && m.lates > 0) {
      finedLateDays = Math.min(lateDays, m.finedLates)
      latePenalty = m
    }
  }

  return {
    absentDays,
    unpaidLeaveDays: fullUnpaidDays,
    halfDayLeaveDays: halfUnpaidDays,
    lateDays: finedLateDays,
    absentDeduction: round2((absentDays + fullUnpaidDays) * perDay + halfUnpaidDays * (perDay / 2)),
    lateDeduction: round2(finedLateDays * lateRate),
    latePenaltyDays: round2(latePenalty.salaryDays),
    latePenaltyDeduction: round2(latePenalty.salaryAmount),
    latePenaltyLeaveDays: round2(latePenalty.leaveDays),
    halfDays: chargedShortDays.length,
    halfDayDeduction: round2(halfDayDeductionDays * perDay),
    earlyGoingDays: chargedShortDays.filter((r) => r.dayType === "EARLY_GOING").length,
    earlyGoingFine: round2(chargedShortDays.reduce((s, r) => s + toNumber(r.earlyGoingFine), 0)),
    fineDeduction,
    expenseReimbursement: await approvedExpenseTotal(prisma, employeeId, month, year),
    performanceBonus: await performanceBonusTotal(prisma, employeeId, month, year),
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

// After the org's fine amounts change: refresh every DRAFT payslip in the
// organization (submitted/paid ones are fixed records). Returns the count.
async function refreshAllDraftPayslips(organizationId) {
  const drafts = await prisma.payrollRecord.findMany({ where: { organizationId, status: "DRAFT" }, select: { employeeId: true, month: true, year: true } })
  for (const d of drafts) await refreshDraftPayslip({ organizationId, ...d })
  return drafts.length
}

// After a fine/status change on the Attendance page: recompute the
// attendance-derived lines of that month's payslip if it's still a DRAFT
// (same as re-running Generate for one employee). Submitted/paid payslips
// are never touched. Returns the payslip status, or null if there is none.
async function refreshDraftPayslip({ organizationId, employeeId, month, year }) {
  const existing = await prisma.payrollRecord.findUnique({ where: { employeeId_month_year: { employeeId, month, year } } })
  if (!existing) return null
  if (existing.status !== "DRAFT") return existing.status
  const lateRate = await orgLateRate(organizationId)
  const lines = await computeAttendanceLines({ employeeId, base: toNumber(existing.baseSalary), month, year, lateRate })
  await prisma.payrollRecord.update({ where: { id: existing.id }, data: { ...lines, ...computePayrollTotals({ ...existing, ...lines }) } })
  return "DRAFT"
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

// GET /api/payroll/preview?month=&year=
// Read-only "review before you generate" view. For every employee Generate
// would touch (ACTIVE with a base salary) plus anyone who already has a
// payslip this month, it shows the attendance the payslip is built from and
// the amounts Generate would write — using the same computeAttendanceLines,
// so the preview always matches the real run. Nothing is written.
// Also lists what HR should look at first: employees Generate will skip
// (no base salary), pending leave / attendance corrections in the month,
// open check-outs, and scheduled workdays with no attendance record (those
// are not deducted — only ABSENT records are).
async function previewPayroll(req, res, next) {
  try {
    const { organizationId } = req.user
    const month = Number(req.query.month)
    const year = Number(req.query.year)
    if (!month || month < 1 || month > 12 || !year) {
      return res.status(400).json({ error: "Valid month (1-12) and year are required" })
    }

    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(year, month, 1)) // exclusive
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { lateDeductionAmount: true, workingDaysPerWeek: true, timezone: true },
    })
    const lateRate = toNumber(organization?.lateDeductionAmount) || 500
    const todayKey = dateKeyInTimeZone(new Date(), organization?.timezone || "UTC")
    const today = new Date(`${todayKey}T00:00:00Z`)

    const [existingRecords, activeUsers, records, holidays, approvedLeaves, pendingLeaves, pendingCorrections] = await Promise.all([
      prisma.payrollRecord.findMany({ where: { organizationId, month, year } }),
      prisma.user.findMany({
        where: { organizationId, status: "ACTIVE" },
        select: { ...PAYSLIP_EMPLOYEE_SELECT, joiningDate: true, createdAt: true, department: { select: { name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({
        where: { organizationId, date: { gte: monthStart, lt: monthEnd } },
        select: { employeeId: true, date: true, status: true, checkInAt: true, checkOutAt: true },
      }),
      prisma.holiday.findMany({ where: { organizationId, date: { gte: monthStart, lt: monthEnd } }, select: { date: true } }),
      prisma.leaveApplication.findMany({
        where: { organizationId, status: "APPROVED", startDate: { lt: monthEnd }, endDate: { gte: monthStart } },
        select: { employeeId: true, type: true, startDate: true, endDate: true, isHalfDay: true },
      }),
      prisma.leaveApplication.findMany({
        where: { organizationId, status: { in: ["PENDING_HR", "PENDING_FINAL_APPROVAL"] }, startDate: { lt: monthEnd }, endDate: { gte: monthStart } },
        select: { id: true, employeeId: true, type: true, startDate: true, endDate: true, employee: { select: { name: true } } },
      }),
      prisma.$queryRaw`
        SELECT c.id, c."employeeId", u.name AS "employeeName", c."requestedCheckInAt", c."requestedCheckOutAt", r.date
        FROM "AttendanceCorrection" c
        JOIN "User" u ON u.id=c."employeeId"
        LEFT JOIN "AttendanceRecord" r ON r.id=c."attendanceId"
        WHERE c."organizationId"=${organizationId} AND c.status='PENDING'
          AND COALESCE(r.date, c."requestedCheckInAt"::date, c."requestedCheckOutAt"::date) >= ${monthStart}
          AND COALESCE(r.date, c."requestedCheckInAt"::date, c."requestedCheckOutAt"::date) < ${monthEnd}
      `,
    ])

    const recordByEmployee = new Map(existingRecords.map((r) => [r.employeeId, r]))
    const holidayKeys = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)))

    // Scheduled workdays in the month (holidays excluded), and the subset
    // that has already happened (before today) — used for "no record" days.
    const workdayKeys = []
    for (let d = new Date(monthStart); d < monthEnd; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      if (isScheduledWorkday(d, organization) && !holidayKeys.has(key)) workdayKeys.push(key)
    }

    const attendanceByEmployee = new Map()
    for (const r of records) {
      const a = attendanceByEmployee.get(r.employeeId) || { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0, openCheckOuts: 0, days: new Set() }
      a[r.status] = (a[r.status] || 0) + 1
      a.days.add(r.date.toISOString().slice(0, 10))
      if (r.checkInAt && !r.checkOutAt && r.date < today) a.openCheckOuts += 1
      attendanceByEmployee.set(r.employeeId, a)
    }

    const paidLeaveByEmployee = new Map()
    for (const l of approvedLeaves) {
      if (l.type === "UNPAID") continue // already part of computeAttendanceLines
      const days = l.isHalfDay ? 0.5 : daysInMonthOverlap(l.startDate, l.endDate, monthStart, monthEnd)
      paidLeaveByEmployee.set(l.employeeId, (paidLeaveByEmployee.get(l.employeeId) || 0) + days)
    }

    // Everyone Generate would touch, plus anyone who already has a payslip
    // (e.g. a termination payslip for someone no longer ACTIVE).
    const eligible = activeUsers.filter((u) => u.baseSalary !== null)
    const eligibleIds = new Set(eligible.map((u) => u.id))
    const extraIds = existingRecords.map((r) => r.employeeId).filter((id) => !eligibleIds.has(id))
    const extraUsers = extraIds.length
      ? await prisma.user.findMany({
          where: { id: { in: extraIds } },
          select: { ...PAYSLIP_EMPLOYEE_SELECT, joiningDate: true, createdAt: true, department: { select: { name: true } } },
        })
      : []

    const employees = []
    for (const emp of [...eligible, ...extraUsers]) {
      const existing = recordByEmployee.get(emp.id)
      const locked = existing && existing.status !== "DRAFT"
      const a = attendanceByEmployee.get(emp.id) || { PRESENT: 0, LATE: 0, ABSENT: 0, LEAVE: 0, openCheckOuts: 0, days: new Set() }
      const startKey = (emp.joiningDate || emp.createdAt).toISOString().slice(0, 10)
      const unrecordedDays = workdayKeys.filter((k) => k >= startKey && k < todayKey && !a.days.has(k)).length

      let action, amounts
      if (locked) {
        action = "locked"
        amounts = existing
      } else {
        const base = toNumber(existing ? existing.baseSalary : emp.baseSalary)
        const lines = await computeAttendanceLines({ employeeId: emp.id, base, month, year, lateRate })
        const manual = existing || { baseSalary: base, bonus: 0, tax: 0, otherDeduction: 0, terminationSettlement: 0, terminationDeduction: 0 }
        action = existing ? "refresh" : eligibleIds.has(emp.id) ? "create" : "locked"
        amounts = { ...manual, ...lines, ...computePayrollTotals({ ...manual, ...lines }) }
      }

      employees.push({
        employeeId: emp.id,
        name: emp.name,
        department: emp.department?.name || null,
        action, // create | refresh (existing DRAFT) | locked (submitted/paid — left untouched)
        payslipStatus: existing?.status || null,
        attendance: {
          present: a.PRESENT,
          late: a.LATE,
          absent: a.ABSENT,
          leave: a.LEAVE,
          paidLeaveDays: paidLeaveByEmployee.get(emp.id) || 0,
          unpaidLeaveDays: toNumber(amounts.unpaidLeaveDays) + toNumber(amounts.halfDayLeaveDays) / 2,
          openCheckOuts: a.openCheckOuts,
          unrecordedDays,
        },
        baseSalary: round2(toNumber(amounts.baseSalary)),
        absentDeduction: round2(toNumber(amounts.absentDeduction)),
        lateDeduction: round2(toNumber(amounts.lateDeduction)),
        halfDays: toNumber(amounts.halfDays),
        halfDayDeduction: round2(toNumber(amounts.halfDayDeduction)),
        latePenaltyDays: toNumber(amounts.latePenaltyDays),
        latePenaltyDeduction: round2(toNumber(amounts.latePenaltyDeduction)),
        latePenaltyLeaveDays: toNumber(amounts.latePenaltyLeaveDays),
        earlyGoingDays: toNumber(amounts.earlyGoingDays),
        earlyGoingFine: round2(toNumber(amounts.earlyGoingFine)),
        adjustmentTotal: round2(toNumber(amounts.adjustmentTotal)),
        fineDeduction: round2(toNumber(amounts.fineDeduction)),
        expenseReimbursement: round2(toNumber(amounts.expenseReimbursement)),
        performanceBonus: round2(toNumber(amounts.performanceBonus)),
        bonus: round2(toNumber(amounts.bonus)),
        tax: round2(toNumber(amounts.tax)),
        otherDeductions: round2(toNumber(amounts.otherDeduction) + toNumber(amounts.terminationDeduction)),
        deductions: round2(toNumber(amounts.deductions)),
        netPay: round2(toNumber(amounts.netPay)),
      })
    }

    const sum = (key) => round2(employees.reduce((s, e) => s + (key(e) || 0), 0))
    res.json({
      month,
      year,
      period: {
        start: monthStart.toISOString().slice(0, 10),
        end: new Date(monthEnd.getTime() - 86400000).toISOString().slice(0, 10),
        workingDays: workdayKeys.length,
        holidays: holidayKeys.size,
        isComplete: monthEnd <= today,
      },
      lateDeductionPerDay: lateRate,
      totals: {
        employees: employees.length,
        create: employees.filter((e) => e.action === "create").length,
        refresh: employees.filter((e) => e.action === "refresh").length,
        locked: employees.filter((e) => e.action === "locked").length,
        absentDays: sum((e) => e.attendance.absent),
        lateDays: sum((e) => e.attendance.late),
        absentDeduction: sum((e) => e.absentDeduction),
        lateDeduction: sum((e) => e.lateDeduction),
        halfDays: sum((e) => e.halfDays),
        halfDayDeduction: sum((e) => e.halfDayDeduction + e.earlyGoingFine),
        latePenaltyDeduction: sum((e) => e.latePenaltyDeduction),
        latePenaltyLeaveDays: sum((e) => e.latePenaltyLeaveDays),
        netPay: sum((e) => e.netPay),
      },
      issues: {
        missingSalary: activeUsers.filter((u) => u.baseSalary === null).map((u) => ({ id: u.id, name: u.name })),
        pendingLeaves: pendingLeaves.map((l) => ({
          id: l.id, employeeId: l.employeeId, name: l.employee?.name, type: l.type,
          startDate: l.startDate.toISOString().slice(0, 10), endDate: l.endDate.toISOString().slice(0, 10),
        })),
        pendingCorrections: pendingCorrections.map((c) => ({ id: c.id, employeeId: c.employeeId, name: c.employeeName })),
        openCheckOuts: employees.filter((e) => e.attendance.openCheckOuts > 0).map((e) => ({ employeeId: e.employeeId, name: e.name, count: e.attendance.openCheckOuts })),
        unrecordedDays: employees.filter((e) => e.attendance.unrecordedDays > 0).map((e) => ({ employeeId: e.employeeId, name: e.name, count: e.attendance.unrecordedDays })),
      },
      employees,
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
        // Manual adjustments after generation → "Adjusted" badge.
        _count: { select: { adjustments: { where: { type: { not: "FIELD_EDIT" } } } } },
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
        performanceBonus: true,
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
      bucket.bonus += toNumber(r.bonus) + toNumber(r.performanceBonus)
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

    const totals = computePayrollTotals({ ...existing, ...data })
    // Every changed amount is kept in the adjustment history (original →
    // new value, who, when, why) — a draft edit is never a silent overwrite.
    const reason = cleanText(req.body.adjustmentReason, 500) || "Edited on the draft payslip"
    const edits = FIELD_EDIT_LINES
      .filter((line) => data[line] !== undefined && round2(toNumber(data[line])) !== round2(toNumber(existing[line])))
      .map((line) => {
        const before = round2(toNumber(existing[line]))
        const after = round2(toNumber(data[line]))
        const sign = ADDITION_LINES.includes(line) ? 1 : -1
        return { line, before, after, effect: round2((after - before) * sign) }
      })
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.payrollRecord.update({ where: { id }, data: { ...data, ...totals } })
      let runningNet = toNumber(existing.netPay)
      for (const e of edits) {
        const nextNet = Math.max(0, round2(runningNet + e.effect))
        await tx.payrollAdjustment.create({
          data: {
            organizationId, payrollRecordId: id, employeeId: existing.employeeId, type: "FIELD_EDIT", line: e.line,
            amount: e.effect, originalValue: e.before, newValue: e.after, previousNetPay: runningNet, newNetPay: nextNet,
            reason, payslipStatus: existing.status, createdById: userId,
          },
        })
        runningNet = nextNet
      }
      return saved
    })
    if (edits.length) {
      logAudit({
        organizationId, actorId: userId, action: "payroll.edited", targetType: "PayrollRecord", targetId: id,
        note: `${existing.month}/${existing.year}: ${edits.map((e) => `${LINE_LABELS[e.line] || e.line} ${e.before} → ${e.after}`).join(", ")} — ${reason}`,
      })
    }

    if (data.terminationDate && !existing.terminationDate) {
      logAudit({ organizationId, actorId: userId, action: "payroll.termination_added", targetType: "PayrollRecord", targetId: id, note: `${existing.month}/${existing.year}` })
    }
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

/* ------------------------------------------------------------------------
   Payroll adjustments — manual, audited changes after a payslip exists.
   Never edits the attendance record itself: removing a late fine here
   credits the payslip, the LATE day stays LATE on the Attendance page.
   Who may adjust, by payslip status (DRAFT = generated, PENDING_APPROVAL =
   submitted to the CEO, PAID = finalized):
     DRAFT            ADMIN, HR, CEO
     PENDING_APPROVAL ADMIN, CEO
     PAID             CEO only, with an explicit confirmFinalized override
------------------------------------------------------------------------ */

const LINE_LABELS = {
  baseSalary: "Basic salary",
  bonus: "Bonus",
  performanceBonus: "Performance bonus",
  expenseReimbursement: "Office expenses",
  terminationSettlement: "Termination settlement",
  tax: "Tax",
  taxPercent: "Tax %",
  absentDeduction: "Absent / unpaid leave",
  lateDeduction: "Late fines",
  halfDayDeduction: "Half-day deductions",
  latePenaltyDeduction: "Late-arrival rule",
  earlyGoingFine: "Early-going fines",
  fineDeduction: "Manual attendance fines",
  otherDeduction: "Other deductions",
  terminationDeduction: "Termination deduction",
  manualFine: "Manual fine",
  manualDeduction: "Manual deduction",
  allowance: "Allowance",
  attendance: "Attendance correction",
  other: "Other adjustment",
}
const ADDITION_LINES = ["bonus", "terminationSettlement"]
// Amount fields a draft edit (PATCH) can change, logged as FIELD_EDIT rows.
const FIELD_EDIT_LINES = ["bonus", "tax", "otherDeduction", "terminationSettlement", "terminationDeduction"]
const FINE_LINES = ["lateDeduction", "absentDeduction", "halfDayDeduction", "latePenaltyDeduction", "earlyGoingFine", "fineDeduction"]
const DEDUCTION_LINES = [...FINE_LINES, "otherDeduction", "tax", "terminationDeduction"]

// sign: +1 raises net pay, -1 lowers it, 0 = the amount's own sign.
// lines: allowed existing payslip lines (credited back, never past their value).
const ADJUSTMENT_TYPES = {
  REMOVE_FINE: { sign: 1, lines: FINE_LINES, removesWholeLine: true, label: "Remove fine" },
  REDUCE_FINE: { sign: 1, lines: FINE_LINES, label: "Reduce fine" },
  ADD_FINE: { sign: -1, defaultLine: "manualFine", label: "Add fine" },
  ADD_DEDUCTION: { sign: -1, defaultLine: "manualDeduction", label: "Add deduction" },
  REMOVE_DEDUCTION: { sign: 1, lines: DEDUCTION_LINES, label: "Remove / reduce deduction" },
  ALLOWANCE: { sign: 1, defaultLine: "allowance", label: "Allowance" },
  ATTENDANCE_CORRECTION: { sign: 0, defaultLine: "attendance", label: "Attendance correction" },
  OTHER: { sign: 0, defaultLine: "other", label: "Other adjustment" },
}

const ADJUST_ROLES = { DRAFT: ["ADMIN", "HR", "CEO"], PENDING_APPROVAL: ["ADMIN", "CEO"], PAID: ["CEO"] }
const MAX_ADJUSTMENT = 10000000

// Net amount already credited back on a line by earlier adjustments.
function creditedOn(adjustments, line) {
  return round2(adjustments.filter((a) => a.type !== "FIELD_EDIT" && a.line === line).reduce((s, a) => s + toNumber(a.amount), 0))
}

function adjustmentTotalOf(adjustments) {
  return round2(adjustments.filter((a) => a.type !== "FIELD_EDIT").reduce((s, a) => s + toNumber(a.amount), 0))
}

function adjustPermission(role, status) {
  const allowed = (ADJUST_ROLES[status] || []).includes(role)
  return { canAdjust: allowed, requiresOverride: allowed && status === "PAID" }
}

function serializeAdjustment(a) {
  return {
    id: a.id,
    type: a.type,
    typeLabel: a.type === "FIELD_EDIT" ? "Payslip edit" : a.type === "REVERSAL" ? "Reversal" : ADJUSTMENT_TYPES[a.type]?.label || a.type,
    line: a.line,
    lineLabel: a.line ? LINE_LABELS[a.line] || a.line : null,
    amount: toNumber(a.amount),
    originalValue: a.originalValue == null ? null : toNumber(a.originalValue),
    newValue: a.newValue == null ? null : toNumber(a.newValue),
    previousNetPay: toNumber(a.previousNetPay),
    newNetPay: toNumber(a.newNetPay),
    reason: a.reason,
    payslipStatus: a.payslipStatus,
    finalizedOverride: a.finalizedOverride,
    reversesId: a.reversesId,
    reversedById: a.reversedBy?.id || null,
    createdAt: a.createdAt,
    createdByName: a.createdBy?.name || null,
    createdByRole: a.createdBy?.role || null,
  }
}

const ADJUSTMENT_INCLUDE = { createdBy: { select: { name: true, role: true } }, reversedBy: { select: { id: true } } }

// Payslip lines with what's been credited back on each.
function lineSummary(record, adjustments) {
  return DEDUCTION_LINES.map((line) => {
    const original = round2(toNumber(record[line]))
    const credited = creditedOn(adjustments, line)
    return { line, label: LINE_LABELS[line], original, credited, effective: round2(original - credited), overCredited: credited > original }
  }).filter((l) => l.original > 0 || l.credited !== 0)
}

// Loads a payslip the caller may see: their own, or any in their current
// organization with the payroll module.
async function loadVisiblePayslip(req) {
  const { userId, organizationId, role } = req.user
  const record = await prisma.payrollRecord.findUnique({
    where: { id: req.params.id },
    include: { employee: { select: { id: true, name: true, email: true, department: { select: { name: true } } } } },
  })
  if (!record) return null
  const isOwn = record.employeeId === userId
  if (!isOwn && !(hasModuleAccess(role, "payroll") && record.organizationId === organizationId)) return null
  return { record, isOwn }
}

// GET /api/payroll/:id/details — full breakdown, the attendance days behind
// the deductions, and the adjustment history.
async function getPayrollDetails(req, res, next) {
  try {
    const visible = await loadVisiblePayslip(req)
    if (!visible) return res.status(404).json({ error: "Payslip not found" })
    const { record, isOwn } = visible
    const monthStart = new Date(Date.UTC(record.year, record.month - 1, 1))
    const monthEnd = new Date(Date.UTC(record.year, record.month, 1))
    const [adjustments, days, waived, organization] = await Promise.all([
      prisma.payrollAdjustment.findMany({ where: { payrollRecordId: record.id }, include: ADJUSTMENT_INCLUDE, orderBy: { createdAt: "asc" } }),
      prisma.attendanceRecord.findMany({
        where: {
          employeeId: record.employeeId,
          date: { gte: monthStart, lt: monthEnd },
          OR: [{ status: { in: ["LATE", "ABSENT"] } }, { dayType: { in: ["HALF_DAY", "EARLY_GOING"] } }],
        },
        select: {
          date: true, status: true, dayType: true, dayTypeReason: true, checkInAt: true, checkOutAt: true,
          scheduledStartAt: true, lateMinutes: true, earlyGoingMinutes: true, deductionDays: true, earlyGoingFine: true,
        },
        orderBy: { date: "asc" },
      }),
      prisma.attendanceFine.findMany({ where: { employeeId: record.employeeId, date: { gte: monthStart, lt: monthEnd }, waived: true }, select: { date: true } }),
      prisma.organization.findUnique({ where: { id: record.organizationId }, select: { timezone: true, absentFineAmount: true, lateDeductionAmount: true } }),
    ])
    const waivedKeys = new Set(waived.map((w) => w.date.toISOString().slice(0, 10)))
    const perDay = toNumber(organization?.absentFineAmount)
    const lateRate = toNumber(organization?.lateDeductionAmount) || 500
    const attendanceDays = days.map((d) => {
      const key = d.date.toISOString().slice(0, 10)
      const shortDay = ["HALF_DAY", "EARLY_GOING"].includes(d.dayType) && ["PRESENT", "LATE"].includes(d.status)
      const amount = waivedKeys.has(key) ? 0
        : shortDay ? round2(toNumber(d.deductionDays) * perDay + toNumber(d.earlyGoingFine))
        : d.status === "LATE" ? lateRate
        : d.status === "ABSENT" ? perDay
        : 0
      return {
        date: key,
        status: d.status,
        dayType: d.dayType,
        reason: d.dayTypeReason || (d.status === "LATE" ? "Late arrival" : d.status === "ABSENT" ? "Absent" : null),
        checkInAt: d.checkInAt, checkOutAt: d.checkOutAt, scheduledStartAt: d.scheduledStartAt,
        lateMinutes: d.lateMinutes, earlyGoingMinutes: d.earlyGoingMinutes,
        deductionDays: d.deductionDays == null ? null : toNumber(d.deductionDays),
        amount,
        waived: waivedKeys.has(key),
      }
    })
    const permission = isOwn && !hasModuleAccess(req.user.role, "payroll")
      ? { canAdjust: false, requiresOverride: false }
      : adjustPermission(req.user.role, record.status)
    // An employee can't adjust their own payslip, whatever their role.
    if (isOwn) permission.canAdjust = false

    res.json({
      record: { ...record, bankAccountNumber: undefined },
      timezone: organization?.timezone || "UTC",
      lines: lineSummary(record, adjustments),
      adjustments: adjustments.map(serializeAdjustment),
      adjusted: adjustments.some((a) => a.type !== "FIELD_EDIT"),
      attendanceDays,
      permission,
      types: Object.entries(ADJUSTMENT_TYPES).map(([key, t]) => ({ key, label: t.label, sign: t.sign, lines: t.lines || null, removesWholeLine: !!t.removesWholeLine })),
      lineLabels: LINE_LABELS,
    })
  } catch (err) {
    next(err)
  }
}

// Applies one adjustment row to a payslip inside a transaction and returns it.
async function writeAdjustment(tx, { record, adjustments, userId, type, line, amount, originalValue, newValue, reason, finalizedOverride, reversesId }) {
  const nextAdjustmentTotal = round2(adjustmentTotalOf(adjustments) + amount)
  const totals = computePayrollTotals({ ...record, adjustmentTotal: nextAdjustmentTotal })
  const row = await tx.payrollAdjustment.create({
    data: {
      organizationId: record.organizationId, payrollRecordId: record.id, employeeId: record.employeeId,
      type, line, amount, originalValue, newValue,
      previousNetPay: toNumber(record.netPay), newNetPay: totals.netPay,
      reason, payslipStatus: record.status, finalizedOverride: !!finalizedOverride, reversesId: reversesId || null, createdById: userId,
    },
    include: ADJUSTMENT_INCLUDE,
  })
  const updated = await tx.payrollRecord.update({ where: { id: record.id }, data: { adjustmentTotal: nextAdjustmentTotal, ...totals } })
  return { row, updated }
}

function checkAdjustAccess(req, record) {
  const { role, userId } = req.user
  if (record.employeeId === userId) return { status: 403, error: "You can't adjust your own payslip" }
  const permission = adjustPermission(role, record.status)
  if (!permission.canAdjust) {
    return {
      status: 403,
      error: record.status === "PAID"
        ? "This payslip is finalized (paid). Only the CEO can change it, through the finalized-payslip override."
        : record.status === "PENDING_APPROVAL"
          ? "This payslip was submitted for approval — only an Admin or the CEO can adjust it now."
          : "You don't have permission to adjust payslips",
    }
  }
  if (permission.requiresOverride && req.body?.confirmFinalized !== true) {
    return { status: 409, code: "FINALIZED", error: "This payslip is finalized (paid). Confirm the finalized-payslip override to record a change." }
  }
  return null
}

// POST /api/payroll/:id/adjustments  { type, line?, amount?, reason, confirmFinalized? }
async function createPayrollAdjustment(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const type = String(req.body?.type || "")
    const def = ADJUSTMENT_TYPES[type]
    if (!def) return res.status(400).json({ error: `type must be one of: ${Object.keys(ADJUSTMENT_TYPES).join(", ")}` })
    const reason = cleanText(req.body?.reason, 500)
    if (!reason) return res.status(400).json({ error: "A reason is required for every payroll adjustment" })

    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findFirst({ where: { id: req.params.id, organizationId } })
      if (!record) return { status: 404, error: "Payroll record not found" }
      const denied = checkAdjustAccess(req, record)
      if (denied) return denied
      const adjustments = await tx.payrollAdjustment.findMany({ where: { payrollRecordId: record.id } })

      let line = def.lines ? String(req.body?.line || "") : def.defaultLine
      if (def.lines && !def.lines.includes(line)) return { status: 400, error: `Pick which line to adjust: ${def.lines.map((l) => LINE_LABELS[l]).join(", ")}` }

      let amount
      let originalValue = null
      let newValue = null
      if (def.lines) {
        const original = round2(toNumber(record[line]))
        const remaining = round2(original - creditedOn(adjustments, line))
        if (remaining <= 0) return { status: 400, error: `${LINE_LABELS[line]} on this payslip is already ${original > 0 ? "fully removed" : "zero"}` }
        if (def.removesWholeLine) {
          amount = remaining
        } else {
          amount = Number(req.body?.amount)
          if (!Number.isFinite(amount) || amount <= 0) return { status: 400, error: "Amount must be a positive number" }
          amount = round2(amount)
          if (amount > remaining) return { status: 400, error: `You can credit at most ${remaining.toLocaleString()} back on ${LINE_LABELS[line]}` }
        }
        originalValue = remaining
        newValue = round2(remaining - amount)
      } else {
        const raw = Number(req.body?.amount)
        if (!Number.isFinite(raw) || raw === 0 || Math.abs(raw) > MAX_ADJUSTMENT) return { status: 400, error: "Amount must be a non-zero number" }
        if (def.sign !== 0 && raw < 0) return { status: 400, error: "Enter the amount as a positive number" }
        amount = round2(def.sign === 0 ? raw : raw * def.sign)
        const before = adjustmentTotalOf(adjustments)
        originalValue = before
        newValue = round2(before + amount)
      }

      const { row, updated } = await writeAdjustment(tx, {
        record, adjustments, userId, type, line, amount, originalValue, newValue, reason,
        finalizedOverride: record.status === "PAID",
      })
      return { row, updated, record }
    })
    if (result.error) return res.status(result.status).json({ error: result.error, code: result.code })

    const { row, updated, record } = result
    logAudit({
      organizationId, actorId: userId, action: "payroll.adjusted", targetType: "PayrollRecord", targetId: record.id,
      note: `${record.month}/${record.year} ${ADJUSTMENT_TYPES[type].label}${row.line ? ` (${LINE_LABELS[row.line] || row.line})` : ""} ${toNumber(row.amount) > 0 ? "+" : ""}${toNumber(row.amount)} — net ${toNumber(row.previousNetPay)} → ${toNumber(row.newNetPay)}${row.finalizedOverride ? " [finalized override]" : ""} — ${reason}`,
    })
    if (record.status !== "DRAFT") {
      createNotification({
        organizationId, recipientId: record.employeeId, createdById: userId, type: "INFO",
        title: "Payslip adjusted",
        message: `${ADJUSTMENT_TYPES[type].label}: ${toNumber(row.amount) > 0 ? "+" : "−"}PKR ${Math.abs(toNumber(row.amount)).toLocaleString()} — ${reason}`,
        link: "/payroll/me",
      }).catch(() => {})
    }
    res.status(201).json({ adjustment: serializeAdjustment(row), record: { ...updated, bankAccountNumber: undefined } })
  } catch (err) {
    next(err)
  }
}

// POST /api/payroll/:id/adjustments/:adjustmentId/reverse  { reason, confirmFinalized? }
// Undoes an adjustment by adding the opposite one — the original row stays
// in the history.
async function reversePayrollAdjustment(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const reason = cleanText(req.body?.reason, 500)
    if (!reason) return res.status(400).json({ error: "A reason is required to reverse an adjustment" })

    const result = await prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.findFirst({ where: { id: req.params.id, organizationId } })
      if (!record) return { status: 404, error: "Payroll record not found" }
      const denied = checkAdjustAccess(req, record)
      if (denied) return denied
      const adjustments = await tx.payrollAdjustment.findMany({ where: { payrollRecordId: record.id }, include: { reversedBy: { select: { id: true } } } })
      const target = adjustments.find((a) => a.id === req.params.adjustmentId)
      if (!target) return { status: 404, error: "Adjustment not found" }
      if (target.type === "FIELD_EDIT") return { status: 400, error: "Payslip edits are changed from the Edit panel, not reversed" }
      if (target.type === "REVERSAL") return { status: 400, error: "A reversal can't be reversed — add a new adjustment instead" }
      if (target.reversedBy) return { status: 409, error: "This adjustment was already reversed" }
      const amount = round2(-toNumber(target.amount))
      const before = target.line && DEDUCTION_LINES.includes(target.line)
        ? round2(toNumber(record[target.line]) - creditedOn(adjustments, target.line))
        : adjustmentTotalOf(adjustments)
      const after = target.line && DEDUCTION_LINES.includes(target.line) ? round2(before - amount) : round2(before + amount)
      const { row, updated } = await writeAdjustment(tx, {
        record, adjustments, userId, type: "REVERSAL", line: target.line, amount, originalValue: before, newValue: after,
        reason, finalizedOverride: record.status === "PAID", reversesId: target.id,
      })
      return { row, updated, record }
    })
    if (result.error) return res.status(result.status).json({ error: result.error, code: result.code })

    logAudit({
      organizationId, actorId: userId, action: "payroll.adjustment_reversed", targetType: "PayrollRecord", targetId: result.record.id,
      note: `${result.record.month}/${result.record.year} reversal ${toNumber(result.row.amount)} — net ${toNumber(result.row.previousNetPay)} → ${toNumber(result.row.newNetPay)} — ${reason}`,
    })
    res.status(201).json({ adjustment: serializeAdjustment(result.row), record: { ...result.updated, bankAccountNumber: undefined } })
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

// Used by the performance bonus: makes sure the employee has a payslip for
// that month, creating a DRAFT one (same data as Generate) if there is none
// yet, so the bonus appears on it right away. Returns
// { record, created } — record is null when the employee has no base
// salary (the bonus is then picked up whenever a payslip is generated).
async function ensurePayslip({ organizationId, userId, employeeId, month, year }) {
  const existing = await prisma.payrollRecord.findUnique({ where: { employeeId_month_year: { employeeId, month, year } } })
  if (existing) return { record: existing, created: false }
  const emp = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: PAYSLIP_EMPLOYEE_SELECT })
  if (!emp || emp.baseSalary === null) return { record: null, created: false }
  const lateRate = await orgLateRate(organizationId)
  try {
    const record = await prisma.payrollRecord.create({ data: await buildPayslipData({ emp, month, year, organizationId, userId, lateRate }) })
    logAudit({ organizationId, actorId: userId, action: "payroll.payslip_created", targetType: "PayrollRecord", targetId: record.id, note: `${emp.name} — ${month}/${year} (performance bonus)` })
    return { record, created: true }
  } catch (err) {
    // Created concurrently (e.g. Generate ran at the same moment).
    if (err.code === "P2002") return { record: await prisma.payrollRecord.findUnique({ where: { employeeId_month_year: { employeeId, month, year } } }), created: false }
    throw err
  }
}

module.exports = {
  ensurePayslip,
  refreshDraftPayslip,
  refreshAllDraftPayslips,
  generatePayroll,
  previewPayroll,
  listPayroll,
  getPayrollSummary,
  myPayroll,
  updatePayroll,
  getPayrollDetails,
  createPayrollAdjustment,
  reversePayrollAdjustment,
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
