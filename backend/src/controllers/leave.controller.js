const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")
const { logAudit } = require("../utils/audit")
const { toDateOnly } = require("../utils/date")

function eachDate(start, end) {
  const days = []
  let cursor = new Date(start)
  while (cursor <= end) {
    days.push(cursor)
    cursor = new Date(cursor)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

function dayCount(start, end) {
  return Math.round((end - start) / 86400000) + 1
}

const MAX_LEAVE_SPAN_DAYS = 60
const LEAVE_TYPES = ["SICK", "CASUAL", "UNPAID"]

async function chargeableDays(organizationId, start, end, isHalfDay) {
  if (isHalfDay) return 0.5
  const holidays = await prisma.holiday.findMany({
    where: { organizationId, date: { gte: start, lte: end } },
    select: { date: true },
  })
  const holidaySet = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)))
  const total = eachDate(start, end).filter((d) => !holidaySet.has(d.toISOString().slice(0, 10))).length
  return total
}

async function findTeamLeaveConflict({ organizationId, employeeId, start, end, excludeLeaveId }) {
  const employee = await prisma.user.findUnique({ where: { id: employeeId }, select: { departmentId: true } })
  if (!employee?.departmentId) return null // no team assigned — nothing to conflict with

  const conflict = await prisma.leaveApplication.findFirst({
    where: {
      organizationId,
      status: "APPROVED",
      employeeId: { not: employeeId },
      employee: { departmentId: employee.departmentId },
      startDate: { lte: end },
      endDate: { gte: start },
      ...(excludeLeaveId ? { id: { not: excludeLeaveId } } : {}),
    },
    include: { employee: { select: { name: true } } },
  })
  return conflict
}

async function createLeave(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { startDate, endDate, reason, type, isHalfDay } = req.body

    if (!startDate || !endDate || !reason || !reason.trim()) {
      return res.status(400).json({ error: "startDate, endDate and reason are required" })
    }

    const leaveType = type || "CASUAL"
    if (!LEAVE_TYPES.includes(leaveType)) {
      return res.status(400).json({ error: `type must be one of: ${LEAVE_TYPES.join(", ")}` })
    }

    const start = toDateOnly(startDate)
    const end = toDateOnly(endDate)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ error: "startDate and endDate must be valid dates" })
    }
    if (end < start) {
      return res.status(400).json({ error: "endDate can't be before startDate" })
    }
    const halfDay = !!isHalfDay && start.getTime() === end.getTime()
    if (isHalfDay && !halfDay) {
      return res.status(400).json({ error: "Half-day leave must have the same startDate and endDate" })
    }
    const spanDays = dayCount(start, end)
    if (spanDays > MAX_LEAVE_SPAN_DAYS) {
      return res.status(400).json({ error: `Leave requests can span at most ${MAX_LEAVE_SPAN_DAYS} days` })
    }

    const conflict = await findTeamLeaveConflict({ organizationId, employeeId: userId, start, end })
    if (conflict) {
      return res.status(409).json({
        error: `${conflict.employee.name} from your team is already on approved leave during this period only one teammate can be off at a time.`,
      })
    }

    const leave = await prisma.leaveApplication.create({
      data: {
        organizationId,
        employeeId: userId,
        startDate: start,
        endDate: end,
        reason: reason.trim().slice(0, 1000),
        type: leaveType,
        isHalfDay: halfDay,
      },
    })

    res.status(201).json(leave)
  } catch (err) {
    next(err)
  }
}

// Employees see only their own applications; management sees the whole org
// (optionally filtered by status / type / employeeId).
async function listLeaves(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { status, type, employeeId } = req.query
    const isManagement = MANAGEMENT_ROLES.includes(role)

    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(isManagement
        ? employeeId
          ? { employeeId }
          : {}
        : { employeeId: userId }),
    }

    const leaves = await prisma.leaveApplication.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
        reviewedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    res.json(leaves)
  } catch (err) {
    next(err)
  }
}

async function getLeave(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { id } = req.params
    const isManagement = MANAGEMENT_ROLES.includes(role)

    const leave = await prisma.leaveApplication.findFirst({
      where: { id, organizationId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (!isManagement && leave.employeeId !== userId) {
      return res.status(403).json({ error: "You can only view your own leave applications" })
    }
    res.json(leave)
  } catch (err) {
    next(err)
  }
}

async function getLeaveBalance(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const isManagement = MANAGEMENT_ROLES.includes(role)
    const employeeId = (isManagement && req.query.employeeId) || userId

    if (!isManagement && employeeId !== userId) {
      return res.status(403).json({ error: "You can only view your own leave balance" })
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId } })
    const allowance = { SICK: org.sickLeaveAllowance, CASUAL: org.casualLeaveAllowance }

    const year = parseInt(req.query.year, 10) || new Date().getFullYear()
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59))

    const approved = await prisma.leaveApplication.findMany({
      where: { organizationId, employeeId, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
      select: { type: true, startDate: true, endDate: true, isHalfDay: true },
    })

    const used = { SICK: 0, CASUAL: 0, UNPAID: 0 }
    for (const leave of approved) {
      const days = await chargeableDays(organizationId, leave.startDate, leave.endDate, leave.isHalfDay)
      used[leave.type] = (used[leave.type] || 0) + days
    }

    res.json({
      year,
      sick: { used: used.SICK, total: allowance.SICK, remaining: Math.max(0, allowance.SICK - used.SICK) },
      casual: { used: used.CASUAL, total: allowance.CASUAL, remaining: Math.max(0, allowance.CASUAL - used.CASUAL) },
      unpaid: { used: used.UNPAID },
      annualTotal: allowance.SICK + allowance.CASUAL,
    })
  } catch (err) {
    next(err)
  }
}

// Month view for the Leave Calendar page — every APPROVED leave that
// overlaps the given month, one row per application (management only).
async function getLeaveCalendar(req, res, next) {
  try {
    const { organizationId } = req.user
    const year = parseInt(req.query.year, 10) || new Date().getFullYear()
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1

    const monthStart = new Date(Date.UTC(year, month - 1, 1))
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59))

    const leaves = await prisma.leaveApplication.findMany({
      where: {
        organizationId,
        status: "APPROVED",
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { startDate: "asc" },
    })

    res.json({ year, month, leaves })
  } catch (err) {
    next(err)
  }
}

// Management approves or rejects a pending application. Approving marks
// every day in the range as LEAVE on the attendance sheet.
async function reviewLeave(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { decision, reviewNote } = req.body

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVED or REJECTED" })
    }

    const leave = await prisma.leaveApplication.findFirst({ where: { id, organizationId } })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (leave.status !== "PENDING") {
      return res.status(400).json({ error: `This application is already ${leave.status.toLowerCase()}` })
    }

    if (decision === "APPROVED") {
      const conflict = await findTeamLeaveConflict({
        organizationId,
        employeeId: leave.employeeId,
        start: leave.startDate,
        end: leave.endDate,
        excludeLeaveId: leave.id,
      })
      if (conflict) {
        return res.status(409).json({
          error: `${conflict.employee.name} from the same team already has approved leave that overlaps this request — only one teammate can be off at a time.`,
        })
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.leaveApplication.update({
        where: { id },
        data: {
          status: decision,
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNote: reviewNote ? String(reviewNote).slice(0, 1000) : null,
        },
      })

      if (decision === "APPROVED" && !leave.isHalfDay) {
        const days = eachDate(leave.startDate, leave.endDate)
        await Promise.all(
          days.map((day) =>
            tx.attendanceRecord.upsert({
              where: { employeeId_date: { employeeId: leave.employeeId, date: day } },
              update: { status: "LEAVE", markedById: userId },
              create: {
                organizationId,
                employeeId: leave.employeeId,
                date: day,
                status: "LEAVE",
                markedById: userId,
              },
            })
          )
        )
      }

      return saved
    })

    logAudit({
      organizationId,
      actorId: userId,
      action: `leave.${decision.toLowerCase()}`,
      targetType: "LeaveApplication",
      targetId: id,
      note: `${leave.type}${leave.isHalfDay ? " (half-day)" : ""} for employee ${leave.employeeId}`,
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// Employee cancels their own still-pending request.
async function cancelLeave(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const leave = await prisma.leaveApplication.findFirst({ where: { id, organizationId } })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (leave.employeeId !== userId) {
      return res.status(403).json({ error: "You can only cancel your own leave applications" })
    }
    if (leave.status !== "PENDING") {
      return res.status(400).json({ error: "Only pending applications can be cancelled" })
    }

    const updated = await prisma.leaveApplication.update({
      where: { id },
      data: { status: "CANCELLED" },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

module.exports = { createLeave, listLeaves, getLeave, getLeaveBalance, getLeaveCalendar, reviewLeave, cancelLeave }
