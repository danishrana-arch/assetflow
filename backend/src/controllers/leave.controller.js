const prisma = require("../lib/prisma")
const { hasModuleAccess } = require("../utils/roles")
const { logAudit } = require("../utils/audit")
const { toDateOnly } = require("../utils/date")
const { notifyManagement, createNotification } = require("../utils/notifications")
const { dateKeyInTimeZone } = require("../utils/timezone")
const { validateLeaveRequest, leaveSchedule, leaveAllowances, NOT_PERMANENT_MESSAGE, PENDING_LEAVE_STATUSES } = require("../utils/leave-policy")
const { refreshDraftPayslip } = require("./payroll.controller")

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
const LEAVE_TYPES = ["ANNUAL", "CASUAL", "SICK", "UNPAID"]

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

const OWNER_ROLES = ["ADMIN", "CEO"]

// HR does step 1. If the organization has no active HR other than the
// applicant (e.g. HR's own leave in a one-HR org), ADMIN/CEO may do it, so a
// request can never get stuck.
async function hrIdsInOrganization(organizationId) {
  const hr = await prisma.user.findMany({ where: { organizationId, role: "HR", status: "ACTIVE" }, select: { id: true } })
  return hr.map((u) => u.id)
}

function canReviewLeave({ leave, userId, role, hrIds }) {
  if (leave.employeeId === userId) return false
  if (leave.status === "PENDING_HR") {
    if (role === "HR") return true
    return OWNER_ROLES.includes(role) && !hrIds.some((id) => id !== leave.employeeId)
  }
  if (leave.status === "PENDING_FINAL_APPROVAL") return OWNER_ROLES.includes(role)
  return false
}

async function createLeave(req, res, next) {
  try {
    const { userId } = req.user
    const { startDate, endDate, reason, type, isHalfDay } = req.body
    // The applicant's own (home) organization — req.user.organizationId can
    // be a switched-to org for ADMIN/CEO.
    const employee = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true, employmentStatus: true, permanentDate: true, joiningDate: true, startDate: true, organization: { select: { timezone: true, sickLeaveAllowance: true, casualLeaveAllowance: true, annualLeaveEntitlement: true } } },
    })
    if (!employee) return res.status(404).json({ error: "User not found" })
    const organizationId = employee.organizationId
    if (employee.employmentStatus !== "PERMANENT") return res.status(403).json({ error: NOT_PERMANENT_MESSAGE })

    if (!startDate || !endDate || !reason || !reason.trim()) {
      return res.status(400).json({ error: "startDate, endDate and reason are required" })
    }

    const leaveType = type || "ANNUAL"
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

    const policyError = await validateLeaveRequest({
      organizationId,
      employee,
      start,
      end,
      isHalfDay: halfDay,
      type: leaveType,
      todayKey: dateKeyInTimeZone(new Date(), employee.organization?.timezone || "UTC"),
      org: employee.organization,
    })
    if (policyError) return res.status(policyError.status).json({ error: policyError.error })

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

    // Step 1 goes to HR (or ADMIN/CEO when there's no other HR to do it).
    const hrIds = await hrIdsInOrganization(organizationId)
    await notifyManagement({
      organizationId,
      createdById: userId,
      type: "LEAVE_REQUEST",
      title: "New leave request",
      message: `${leave.type} leave from ${startDate} to ${endDate} — waiting for HR approval.`,
      link: "/leave-requests",
      roles: hrIds.some((id) => id !== userId) ? ["HR"] : OWNER_ROLES,
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
    const { organizationId, userId, role, departmentId } = req.user
    const { status, type, employeeId } = req.query
    // ?mine=1 — the requester's own applications even when they have the
    // leave module (My Attendance), across their home org.
    const mine = req.query.mine === "1" || req.query.mine === "true"
    const isManagement = hasModuleAccess(role, "leave") && !mine
    // "PENDING" = either pending stage (older clients / filters).
    const statusWhere = status === "PENDING" ? { status: { in: PENDING_LEAVE_STATUSES } } : status ? { status } : {}

    const where = {
      ...(mine ? {} : { organizationId }),
      ...statusWhere,
      ...(type ? { type } : {}),
      ...(isManagement
        ? role === "DEPARTMENT_HEAD"
          ? { employeeId: employeeId || undefined, employee: { departmentId: departmentId || "__none__" } }
          : employeeId
            ? { employeeId }
            : {}
        : { employeeId: userId }),
    }

    const [leaves, hrIds] = await Promise.all([
      prisma.leaveApplication.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
          reviewedBy: { select: { id: true, name: true, role: true } },
          hrReviewedBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      isManagement ? hrIdsInOrganization(organizationId) : [],
    ])

    res.json(leaves.map((leave) => ({ ...leave, canReview: isManagement && canReviewLeave({ leave, userId, role, hrIds }) })))
  } catch (err) {
    next(err)
  }
}

async function getLeave(req, res, next) {
  try {
    const { organizationId, userId, role, departmentId } = req.user
    const { id } = req.params
    const isManagement = hasModuleAccess(role, "leave")

    const leave = await prisma.leaveApplication.findFirst({
      where: { id, organizationId },
      include: {
        employee: { select: { id: true, name: true, email: true, departmentId: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (!isManagement && leave.employeeId !== userId) {
      return res.status(403).json({ error: "You can only view your own leave applications" })
    }
    if (
      isManagement &&
      role === "DEPARTMENT_HEAD" &&
      leave.employeeId !== userId &&
      leave.employee.departmentId !== departmentId
    ) {
      return res.status(403).json({ error: "You can only view leave applications from your own department" })
    }
    res.json(leave)
  } catch (err) {
    next(err)
  }
}

async function getLeaveBalance(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const isManagement = hasModuleAccess(role, "leave")
    const employeeId = (isManagement && req.query.employeeId) || userId

    if (!isManagement && employeeId !== userId) {
      return res.status(403).json({ error: "You can only view your own leave balance" })
    }

    const employee = await prisma.user.findFirst({
      where: { id: employeeId, ...(employeeId === userId ? {} : { organizationId }) },
      select: { id: true, organizationId: true, employmentStatus: true, permanentDate: true, joiningDate: true, startDate: true },
    })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const org = await prisma.organization.findUnique({ where: { id: employee.organizationId } })

    const todayKey = dateKeyInTimeZone(new Date(), org.timezone || "UTC")
    const year = parseInt(req.query.year, 10) || Number(todayKey.slice(0, 4))
    const yearStart = new Date(Date.UTC(year, 0, 1))
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59))

    const approved = await prisma.leaveApplication.findMany({
      where: { organizationId: employee.organizationId, employeeId, status: "APPROVED", startDate: { gte: yearStart, lte: yearEnd } },
      select: { type: true, startDate: true, endDate: true, isHalfDay: true, payAs: true },
    })

    const used = { ANNUAL: 0, CASUAL: 0, SICK: 0, UNPAID: 0 }
    for (const leave of approved) {
      const days = await chargeableDays(employee.organizationId, leave.startDate, leave.endDate, leave.isHalfDay)
      const bucketKey = leave.payAs === "UNPAID" ? "UNPAID" : leave.type
      used[bucketKey] = (used[bucketKey] || 0) + days
    }

    // Pro-rata picture (approved + pending count against what's earned —
    // utils/leave-policy.js). Per type: total = this year's pro-rated
    // limit, used = approved only, remaining also subtracts pending.
    const schedule = await leaveSchedule({ organizationId: employee.organizationId, employee, org, year, todayKey })
    const bucket = (type) => ({
      used: used[type],
      total: schedule.types[type].total,
      fullYear: schedule.types[type].fullYear,
      pending: Math.max(0, schedule.types[type].used - used[type]),
      remaining: schedule.types[type].remaining,
    })
    const allowances = leaveAllowances(org)

    res.json({
      year,
      annual: bucket("ANNUAL"),
      casual: bucket("CASUAL"),
      sick: bucket("SICK"),
      unpaid: { used: used.UNPAID },
      entitlement: allowances.total,
      annualTotal: schedule.yearEntitlement,
      earnedToDate: schedule.currentMonth?.accrued ?? null,
      availableNow: schedule.currentMonth?.remaining ?? null,
      schedule,
    })
  } catch (err) {
    next(err)
  }
}

// Month view for the Leave Calendar page — every APPROVED leave that
// overlaps the given month, one row per application (management only).
async function getLeaveCalendar(req, res, next) {
  try {
    const { organizationId, role, departmentId } = req.user
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
        ...(role === "DEPARTMENT_HEAD" ? { employee: { departmentId: departmentId || "__none__" } } : {}),
      },
      include: { employee: { select: { id: true, name: true } } },
      orderBy: { startDate: "asc" },
    })

    res.json({ year, month, leaves })
  } catch (err) {
    next(err)
  }
}

// Two steps: HR approves/rejects a PENDING_HR request (approve → it moves
// to PENDING_FINAL_APPROVAL for ADMIN/CEO); then either an ADMIN or a CEO
// gives the final decision. Only the final approval marks the days as LEAVE
// on the attendance sheet. Nobody reviews their own request.
async function reviewLeave(req, res, next) {
  try {
    const { organizationId, userId, role, departmentId } = req.user
    const { id } = req.params
    const { decision, reviewNote } = req.body

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVED or REJECTED" })
    }

    const leave = await prisma.leaveApplication.findFirst({
      where: { id, organizationId },
      include: { employee: { select: { departmentId: true, name: true } } },
    })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (role === "DEPARTMENT_HEAD" && leave.employee.departmentId !== departmentId) {
      return res.status(404).json({ error: "Leave application not found" })
    }
    if (!PENDING_LEAVE_STATUSES.includes(leave.status)) {
      return res.status(400).json({ error: `This application is already ${leave.status.toLowerCase()}` })
    }
    if (leave.employeeId === userId) {
      return res.status(403).json({ error: "You can't review your own leave request" })
    }
    const hrIds = leave.status === "PENDING_HR" ? await hrIdsInOrganization(organizationId) : []
    if (!canReviewLeave({ leave, userId, role, hrIds })) {
      return res.status(403).json({
        error: leave.status === "PENDING_HR"
          ? "This request is waiting for HR approval first"
          : "Only an Admin or CEO can give the final approval",
      })
    }
    const note = reviewNote ? String(reviewNote).slice(0, 1000) : null
    const now = new Date()

    // Step 1 (HR).
    if (leave.status === "PENDING_HR") {
      const saved = await prisma.leaveApplication.update({
        where: { id },
        data: decision === "APPROVED"
          ? { status: "PENDING_FINAL_APPROVAL", hrReviewedById: userId, hrReviewedAt: now, hrReviewNote: note }
          : { status: "REJECTED", hrReviewedById: userId, hrReviewedAt: now, hrReviewNote: note, reviewedById: userId, reviewedAt: now, reviewNote: note },
      })
      logAudit({
        organizationId,
        actorId: userId,
        action: decision === "APPROVED" ? "leave.hr_approved" : "leave.rejected",
        targetType: "LeaveApplication",
        targetId: id,
        note: `${leave.type}${leave.isHalfDay ? " (half-day)" : ""} for employee ${leave.employeeId} (HR step)`,
      })
      if (decision === "APPROVED") {
        await notifyManagement({
          organizationId,
          createdById: userId,
          type: "LEAVE_REQUEST",
          title: "Leave request needs final approval",
          message: `${leave.employee.name}: ${leave.type} leave, approved by HR — waiting for Admin/CEO approval.`,
          link: "/leave-requests",
          roles: OWNER_ROLES,
        })
      }
      await createNotification({
        organizationId,
        recipientId: leave.employeeId,
        createdById: userId,
        type: "LEAVE_REQUEST",
        title: decision === "APPROVED" ? "Leave request approved by HR" : "Leave request rejected",
        message: decision === "APPROVED"
          ? `${leave.type} leave was approved by HR and is now waiting for final approval.`
          : `${leave.type} leave was rejected by HR.${note ? ` ${note}` : ""}`,
        link: "/attendance/me",
      })
      return res.json(saved)
    }

    // Step 2 (final, ADMIN or CEO).
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

    // Paid or unpaid — the final approver decides (UNPAID-type requests are
    // always unpaid). Unpaid full days are marked ABSENT, so payroll charges
    // the absent fine for them; an unpaid half day is charged half of it.
    let payAs = null
    if (decision === "APPROVED") {
      if (leave.type === "UNPAID") payAs = "UNPAID"
      else {
        payAs = req.body.payAs || "PAID"
        if (!["PAID", "UNPAID"].includes(payAs)) return res.status(400).json({ error: "payAs must be PAID or UNPAID" })
      }
    }
    const markAbsent = payAs === "UNPAID" && leave.type !== "UNPAID"
    const days = decision === "APPROVED" && !leave.isHalfDay ? eachDate(leave.startDate, leave.endDate) : []

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.leaveApplication.update({
        where: { id },
        data: {
          status: decision,
          reviewedById: userId,
          reviewedAt: now,
          reviewNote: note,
          payAs,
        },
      })

      const status = markAbsent ? "ABSENT" : "LEAVE"
      await Promise.all(
        days.map((day) =>
          tx.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: leave.employeeId, date: day } },
            update: { status, markedById: userId },
            create: { organizationId, employeeId: leave.employeeId, date: day, status, markedById: userId },
          })
        )
      )

      // Day note so the Attendance page says why the day is Absent.
      if (markAbsent) {
        const text = `${leave.type.charAt(0) + leave.type.slice(1).toLowerCase()} leave approved as unpaid — marked absent, absent fine applies.`
        for (const day of days) {
          const existingNote = await tx.attendanceNote.findUnique({ where: { employeeId_date: { employeeId: leave.employeeId, date: day } } })
          if (existingNote) {
            if (!existingNote.note.includes(text)) {
              await tx.attendanceNote.update({ where: { id: existingNote.id }, data: { note: `${existingNote.note}\n${text}`.slice(0, 500) } })
            }
          } else {
            await tx.attendanceNote.create({ data: { organizationId, employeeId: leave.employeeId, date: day, note: text, authorId: userId } })
          }
        }
      }

      return saved
    })

    // Keep DRAFT payslips of the affected months current.
    if (decision === "APPROVED") {
      const months = new Set()
      for (let d = new Date(leave.startDate); d <= leave.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
        months.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`)
      }
      for (const key of months) {
        const [year, month] = key.split("-").map(Number)
        await refreshDraftPayslip({ organizationId, employeeId: leave.employeeId, month, year }).catch(() => {})
      }
    }

    logAudit({
      organizationId,
      actorId: userId,
      action: `leave.${decision.toLowerCase()}`,
      targetType: "LeaveApplication",
      targetId: id,
      note: `${leave.type}${leave.isHalfDay ? " (half-day)" : ""} for employee ${leave.employeeId}${payAs ? ` — ${payAs.toLowerCase()}` : ""}`,
    })

    await createNotification({
      organizationId,
      recipientId: leave.employeeId,
      createdById: userId,
      type: "LEAVE_REQUEST",
      title: `Leave request ${decision.toLowerCase()}`,
      message: `${leave.type} leave was ${decision === "APPROVED" ? (markAbsent ? "approved as unpaid — those days are marked absent and the absent fine applies" : "approved") : "rejected at final approval"}.${note ? ` ${note}` : ""}`,
      link: "/attendance/me",
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// Employee cancels their own still-pending request.
async function cancelLeave(req, res, next) {
  try {
    const { userId } = req.user
    const { id } = req.params

    // Own requests live in the applicant's home org (see createLeave).
    const leave = await prisma.leaveApplication.findFirst({ where: { id, employeeId: userId } })
    if (!leave) return res.status(404).json({ error: "Leave application not found" })
    if (leave.employeeId !== userId) {
      return res.status(403).json({ error: "You can only cancel your own leave applications" })
    }
    if (!PENDING_LEAVE_STATUSES.includes(leave.status)) {
      return res.status(400).json({ error: "Only pending applications can be cancelled" })
    }

    // Removed outright (same as cancelling an asset request) rather than
    // kept as a CANCELLED row — a still-pending request has no approval
    // history worth keeping.
    await prisma.leaveApplication.delete({ where: { id } })

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { createLeave, listLeaves, getLeave, getLeaveBalance, getLeaveCalendar, reviewLeave, cancelLeave }
