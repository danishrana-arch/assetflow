const crypto = require("crypto")
const prisma = require("../lib/prisma")
const ExcelJS = require("exceljs")
const { toDateOnly } = require("../utils/date")
const { workingMinutesPerDay, expectedWeeklyMinutes, isScheduledWorkday } = require("../utils/work-schedule")
const { distanceMeters } = require("../utils/geo")
const { siteDistance } = require("../utils/site-geofence")
const { dateKeyInTimeZone, localMinutes } = require("../utils/timezone")
const { isLateCheckIn, resolveArrivalStatus, formatTime12, shiftStartMinutes } = require("../utils/attendance-rules")
const { createNotification, notifyManagement } = require("../utils/notifications")
const { refreshDraftPayslip, refreshAllDraftPayslips } = require("./payroll.controller")
const { logAudit } = require("../utils/audit")
const { attendancePolicy, applyAttendanceEvaluation, dayDeductionAmount, refreshPayslipForDay } = require("../services/attendance-engine")

// Roles that manage fines and employee notes on the Attendance page.
const FINE_ROLES = ["ADMIN", "CEO", "HR"]

function startOfDay(dateStr, timeZone) {
  if (dateStr) return toDateOnly(dateStr)
  return toDateOnly(dateKeyInTimeZone(new Date(), timeZone || "UTC"))
}

// Active sites an employee is bound to — assigned directly, or a member of
// the site's linked (non-completed) project. Same rule as
// listAssignedSites in attendance-site.controller.js.
function findAssignedSites(db, organizationId, userId) {
  return db.$queryRaw`
    SELECT DISTINCT s.* FROM "AttendanceSite" s
    LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${userId}
    LEFT JOIN "Project" p ON p.id=s."projectId"
    WHERE s."organizationId"=${organizationId} AND s.active=TRUE
      AND (s."projectId" IS NULL OR p.status::text <> 'COMPLETED')
      AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${userId}))
  `
}

// Picks the site to attribute a location to: an inside match first, else
// the nearest one. `eligible` is true when the location satisfies any
// assigned site (inside it, or the site has its geofence DISABLED).
function matchAssignedSite(sites, latitude, longitude) {
  let best = null
  let eligible = false
  for (const site of sites) {
    const result = siteDistance(site, latitude, longitude)
    if (result.inside || site.geofenceMode === "DISABLED") eligible = true
    if (!best || (result.inside && !best.inside) || (result.inside === best.inside && result.distance < best.distance)) {
      best = { site, distance: result.distance, inside: result.inside }
    }
  }
  return { ...best, eligible }
}

async function getDailyAttendance(req, res, next) {
  try {
    const { organizationId, role, departmentId } = req.user
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          workingHoursPerDay: true,
          workingDaysPerWeek: true, workingDays: true,
          geofenceEnabled: true,
          officeLatitude: true,
          officeLongitude: true,
          geofenceRadiusMeters: true,
          timezone: true,
          breakStart: true,
          breakEnd: true,
          shiftStartDefault: true,
          lateDeductionAmount: true,
          absentFineAmount: true,
          lateThresholdMinutes: true,
          lateHalfDayThresholdHours: true,
          halfDayMinimumHours: true,
          earlyGoingThresholdHours: true,
          earlyGoingFineAmount: true,
          halfDayDeductionPercent: true,
        },
      })
    const date = startOfDay(req.query.date, organization?.timezone)
    // Fine amounts are salary-derived, so only the roles that manage fines
    // (HR/ADMIN/CEO) get them.
    const canFine = FINE_ROLES.includes(role)

    const [employees, records, notes, fines, payslips] = await Promise.all([
      prisma.user.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          // DEPARTMENT_HEAD only ever sees their own department's roster.
          ...(role === "DEPARTMENT_HEAD" ? { departmentId: departmentId || "__none__" } : {}),
        },
        include: { department: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({
        where: { organizationId, date },
        include: { markedBy: { select: { id: true, name: true, role: true } } },
      }),
      prisma.attendanceNote.findMany({
        where: { organizationId, date },
        include: { author: { select: { name: true } } },
      }),
      canFine
        ? prisma.attendanceFine.findMany({ where: { organizationId, date }, include: { updatedBy: { select: { name: true } } } })
        : [],
      canFine
        ? prisma.payrollRecord.findMany({
            where: { organizationId, month: date.getUTCMonth() + 1, year: date.getUTCFullYear() },
            select: { employeeId: true, status: true },
          })
        : [],
    ])

    const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]))
    const noteByEmployee = new Map(notes.map((n) => [n.employeeId, n]))
    const fineByEmployee = new Map(fines.map((f) => [f.employeeId, f]))
    const payslipStatus = new Map(payslips.map((p) => [p.employeeId, p.status]))
    const lateRate = Number(organization?.lateDeductionAmount) || 500
    const seenByIds = [...new Set(records.map((r) => r.employeeNoteSeenById).filter(Boolean))]
    const seenByName = new Map(
      (seenByIds.length ? await prisma.user.findMany({ where: { id: { in: seenByIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name])
    )

    // The automatic fine payroll applies for this day (same rules as
    // computeAttendanceLines): a HALF_DAY / EARLY_GOING day → its day-rate
    // deduction (+ early-going fine), replacing the late fine; LATE → org
    // late fine; an ABSENT *record* → org absent fine (none set = no fine).
    // A day with no record isn't fined.
    const absentFine = Number(organization?.absentFineAmount) || 0
    function fineFor(emp, record) {
      const fine = fineByEmployee.get(emp.id)
      const shortDay = record && ["HALF_DAY", "EARLY_GOING"].includes(record.dayType) && ["PRESENT", "LATE"].includes(record.status)
      const auto =
        shortDay ? { type: record.dayType, amount: dayDeductionAmount(record, organization) }
        : record?.status === "LATE" ? { type: "LATE", amount: lateRate }
        : record?.status === "ABSENT" && absentFine > 0 ? { type: "ABSENT", amount: absentFine }
        : null
      const ps = payslipStatus.get(emp.id) || null
      return {
        autoType: auto?.type || null,
        autoAmount: auto?.amount || 0,
        waived: !!fine?.waived,
        extraAmount: fine ? Number(fine.extraAmount) : 0,
        reason: fine?.reason || null,
        updatedByName: fine?.updatedBy?.name || null,
        total: (auto && !fine?.waived ? auto.amount : 0) + (fine ? Number(fine.extraAmount) : 0),
        payslipStatus: ps,
        locked: !!ps && ps !== "DRAFT",
        noSalary: emp.baseSalary == null,
      }
    }

    // Names for the Location column: the matched attendance site, or the
    // biometric device the punch came from.
    const siteIds = [...new Set(records.flatMap((r) => [r.siteId, r.checkOutSiteId]).filter(Boolean))]
    const deviceIds = [...new Set(records.map((r) => r.biometricDeviceId).filter(Boolean))]
    const [sites, devices] = await Promise.all([
      siteIds.length ? prisma.attendanceSite.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true, Project: { select: { name: true } } } }) : [],
      deviceIds.length ? prisma.biometricDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }) : [],
    ])
    const siteName = new Map(sites.map((s) => [s.id, s.name]))
    const siteProject = new Map(sites.map((s) => [s.id, s.Project?.name || null]))
    const deviceName = new Map(devices.map((d) => [d.id, d.name]))

    const rows = employees.map((emp) => {
      const record = recordByEmployee.get(emp.id)
      return {
        employeeId: emp.id,
        name: emp.name,
        department: emp.department?.name || null,
        status: record?.status || "ABSENT",
        recordId: record?.id || null,
        time: record?.updatedAt?.toISOString() || null,
        checkInAt: record?.checkInAt?.toISOString() || null,
        checkOutAt: record?.checkOutAt?.toISOString() || null,
        // Minutes past the employee's shift start (same shift rule as the
        // late check) — only for LATE rows with a recorded check-in. Stored
        // by the attendance engine; older records fall back to the old math.
        lateMinutes:
          record?.status === "LATE" && record.checkInAt
            ? record.lateMinutes ?? Math.max(0, localMinutes(record.checkInAt, organization?.timezone || "UTC") - shiftStartMinutes(emp, organization))
            : null,
        // Attendance engine result: HALF_DAY / EARLY_GOING / FULL_DAY, why,
        // and the deduction (days; the amount is in `fine` for fine roles).
        dayType: record?.dayType || null,
        dayTypeReason: record?.dayTypeReason || null,
        scheduledStartAt: record?.scheduledStartAt?.toISOString() || null,
        scheduledEndAt: record?.scheduledEndAt?.toISOString() || null,
        lateDurationMinutes: record?.lateMinutes ?? null,
        earlyGoingMinutes: record?.earlyGoingMinutes ?? null,
        deductionDays: record?.deductionDays != null ? Number(record.deductionDays) : null,
        earlyGoingFineAmount: record?.earlyGoingFine != null ? Number(record.earlyGoingFine) : null,
        markedByRole: record?.markedBy?.role || null,
        checkOutSiteName: record?.checkOutSiteId ? siteName.get(record.checkOutSiteId) || null : null,
        projectName: record?.siteId ? siteProject.get(record.siteId) || null : null,
        // Signed minutes from shift start to check-in (negative = early
        // clock-in). Null when there's no check-in.
        arrivalOffsetMinutes: record?.checkInAt
          ? localMinutes(record.checkInAt, organization?.timezone || "UTC") - shiftStartMinutes(emp, organization)
          : null,
        markedById: record?.markedById || null,
        offlineRecorded: record?.offlineRecorded || false,
        siteName: record?.siteId ? siteName.get(record.siteId) || null : null,
        deviceName: record?.biometricDeviceId ? deviceName.get(record.biometricDeviceId) || null : null,
        note: noteByEmployee.get(emp.id)?.note || null,
        noteAuthorName: noteByEmployee.get(emp.id)?.author?.name || null,
        noteUpdatedAt: noteByEmployee.get(emp.id)?.updatedAt?.toISOString() || null,
        employeeNote: record?.employeeNote || null,
        extraMinutes: record?.extraMinutes ?? null,
        employeeNoteSeenAt: record?.employeeNoteSeenAt?.toISOString() || null,
        employeeNoteSeenByName: record?.employeeNoteSeenById ? seenByName.get(record.employeeNoteSeenById) || null : null,
        ...(canFine ? { fine: fineFor(emp, record) } : {}),
        autoCheckedOut: record?.autoCheckedOut || false,
        workingMinutes: record?.workingMinutes ?? null,
        expectedWorkingMinutes: workingMinutesPerDay(organization),
        expectedWeeklyMinutes: expectedWeeklyMinutes(organization),
        isScheduledWorkday: isScheduledWorkday(date, organization),
        source: record?.source || "MANUAL",
        markedByName: record?.markedBy?.name || null,
        workLocationType: emp.workLocationType || "OFFICE",
        locationMode: record?.locationMode || "OFFICE",
        // Geofence info: only meaningful when the record was self-marked
        // with a location and the employee is OFFICE-type. autoFlagged
        // means the system overrode a "Present" attempt to "Absent"
        // because the punch came from outside the office radius — an
        // admin can review the coordinates below and override the status.
        autoFlagged: record?.autoFlagged || false,
        distanceMeters: record?.distanceMeters ?? null,
        latitude: record?.latitude != null ? Number(record.latitude) : null,
        longitude: record?.longitude != null ? Number(record.longitude) : null,
      }
    })

    res.json({
      date: date.toISOString().slice(0, 10),
      schedule: {
        workingHoursPerDay: Number(organization?.workingHoursPerDay ?? 8),
        workingDaysPerWeek: Number(organization?.workingDaysPerWeek ?? 5),
        expectedWeeklyMinutes: expectedWeeklyMinutes(organization),
        isScheduledWorkday: isScheduledWorkday(date, organization),
        timezone: organization?.timezone || "UTC",
        breakStart: organization?.breakStart || null,
        breakEnd: organization?.breakEnd || null,
      },
      ...(canFine
        ? {
            fineSettings: {
              lateFine: lateRate,
              absentFine: organization?.absentFineAmount != null ? Number(organization.absentFineAmount) : null,
              ...policySettings(organization),
            },
          }
        : {}),
      rows,
    })
  } catch (err) {
    next(err)
  }
}

const NOTE_MAX_LENGTH = 500

// System note added when a check-in comes from outside the premises (see
// markSelfAttendance / syncOfflineAttendance). Appended to any existing note
// for that day rather than replacing what HR wrote; authorId stays as-is
// (null for a note the system created).
async function addOutsidePremisesNote(db, organizationId, employeeId, date, distance, where) {
  const text = `Marked attendance outside the office premises (${distance}m from ${where}) — recorded as Late automatically. HR can change it to Present.`
  const existing = await db.attendanceNote.findUnique({ where: { employeeId_date: { employeeId, date } } })
  if (existing?.note.includes("outside the office premises")) return
  const note = (existing ? `${existing.note}\n${text}` : text).slice(0, NOTE_MAX_LENGTH)
  await db.attendanceNote.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { note },
    create: { organizationId, employeeId, date, note },
  })
}

// PUT /attendance/notes — add, change or clear (empty text) the note on one
// employee's day. Route-gated to ADMIN/CEO/HR. Notes live in their own table
// so writing one never creates an attendance record or changes a status.
async function setAttendanceNote(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { employeeId, date } = req.body || {}
    const text = String(req.body?.note ?? "").trim()

    if (!employeeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "employeeId and date (YYYY-MM-DD) are required" })
    }
    if (text.length > NOTE_MAX_LENGTH) {
      return res.status(400).json({ error: `Note must be ${NOTE_MAX_LENGTH} characters or fewer` })
    }

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const day = toDateOnly(String(date))
    if (!text) {
      await prisma.attendanceNote.deleteMany({ where: { employeeId, date: day } })
      return res.json({ employeeId, date, note: null, noteAuthorName: null, noteUpdatedAt: null })
    }

    const saved = await prisma.attendanceNote.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: { note: text, authorId: userId },
      create: { organizationId, employeeId, date: day, note: text, authorId: userId },
      include: { author: { select: { name: true } } },
    })
    res.json({
      employeeId,
      date,
      note: saved.note,
      noteAuthorName: saved.author?.name || null,
      noteUpdatedAt: saved.updatedAt.toISOString(),
    })
  } catch (err) {
    next(err)
  }
}

const MAX_FINE = 1000000

// PUT /attendance/fines  { employeeId, date, waived, extraAmount, reason }
// HR/ADMIN/CEO only (route). Waive the day's automatic late/absent fine
// and/or add a manual fine; waived=false + extraAmount=0 clears it. A
// DRAFT payslip for that month is refreshed right away; once the month's
// payslip is submitted or paid the fine is locked (400).
async function setAttendanceFine(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { employeeId, date } = req.body || {}
    if (!employeeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "employeeId and date (YYYY-MM-DD) are required" })
    }
    const waived = !!req.body.waived
    const extraAmount = req.body.extraAmount === "" || req.body.extraAmount == null ? 0 : Number(req.body.extraAmount)
    if (Number.isNaN(extraAmount) || extraAmount < 0 || extraAmount > MAX_FINE) {
      return res.status(400).json({ error: "Fine amount must be a number between 0 and 1,000,000" })
    }
    const reason = String(req.body.reason || "").trim().slice(0, 500) || null
    if (extraAmount > 0 && !reason) return res.status(400).json({ error: "Give a reason for the fine — the employee sees it on their payslip line" })

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true, name: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const day = toDateOnly(String(date))
    const month = day.getUTCMonth() + 1
    const year = day.getUTCFullYear()
    const payslip = await prisma.payrollRecord.findUnique({ where: { employeeId_month_year: { employeeId, month, year } }, select: { status: true } })
    if (payslip && payslip.status !== "DRAFT") {
      return res.status(400).json({ error: `${employee.name}'s payslip for this month is already ${payslip.status === "PAID" ? "paid" : "submitted"} — fines can't be changed now` })
    }

    let fine = null
    if (!waived && extraAmount === 0) {
      await prisma.attendanceFine.deleteMany({ where: { employeeId, date: day } })
    } else {
      fine = await prisma.attendanceFine.upsert({
        where: { employeeId_date: { employeeId, date: day } },
        update: { waived, extraAmount, reason, updatedById: userId },
        create: { organizationId, employeeId, date: day, waived, extraAmount, reason, updatedById: userId },
      })
    }
    const payslipStatus = await refreshDraftPayslip({ organizationId, employeeId, month, year })
    logAudit({
      organizationId, actorId: userId, action: "attendance.fine_set", targetType: "User", targetId: employeeId,
      note: `${employee.name} ${date}: ${waived ? "waived" : "not waived"}, extra ${extraAmount}${reason ? ` — ${reason}` : ""}`,
    })
    if (extraAmount > 0) {
      createNotification({
        organizationId, recipientId: employeeId, createdById: userId, type: "INFO",
        title: "Attendance fine added",
        message: `PKR ${extraAmount.toLocaleString()} for ${date}: ${reason}`,
        link: "/payroll/me",
      }).catch(() => {})
    }
    res.json({ employeeId, date, waived, extraAmount, reason, payslipStatus, id: fine?.id || null })
  } catch (err) {
    next(err)
  }
}

// The half-day / early-going policy as the Attendance page shows it.
function policySettings(org) {
  const p = attendancePolicy(org)
  return {
    lateHalfDayThresholdHours: p.lateHalfDayThresholdHours,
    halfDayMinimumHours: p.halfDayMinimumHours,
    earlyGoingThresholdHours: p.earlyGoingThresholdHours,
    earlyGoingFineAmount: p.earlyGoingFineAmount,
    halfDayDeductionPercent: p.halfDayDeductionPercent,
  }
}

// Optional policy fields of PUT /attendance/fine-settings: [key, label, max].
const POLICY_FIELDS = [
  ["lateHalfDayThresholdHours", "Late-arrival half-day threshold", 12],
  ["halfDayMinimumHours", "Minimum hours for a full day", 24],
  ["earlyGoingThresholdHours", "Very-short-day threshold", 24],
  ["earlyGoingFineAmount", "Early-going fine", MAX_FINE],
  ["halfDayDeductionPercent", "Half-day deduction", 100],
]

// PUT /attendance/fine-settings  { lateFine, absentFine, ...policy }
// HR/ADMIN/CEO only (route). Fine per LATE day (Organization.lateDeductionAmount)
// and per ABSENT / unpaid-leave day (absentFineAmount; null/"" = no fine),
// plus the attendance policy (half day / early going, see
// services/attendance-engine.js) when sent. Every DRAFT payslip is
// refreshed so the new amounts apply right away; submitted/paid payslips
// keep what they were issued with. Policy changes apply to attendance
// recorded from now on (existing days keep their stored result).
async function setFineSettings(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const late = Number(req.body?.lateFine)
    if (req.body?.lateFine === "" || req.body?.lateFine == null || Number.isNaN(late) || late < 0 || late > MAX_FINE) {
      return res.status(400).json({ error: "Late fine must be a number between 0 and 1,000,000" })
    }
    const rawAbsent = req.body?.absentFine
    const absent = rawAbsent === "" || rawAbsent == null ? null : Number(rawAbsent)
    if (absent !== null && (Number.isNaN(absent) || absent < 0 || absent > MAX_FINE)) {
      return res.status(400).json({ error: "Absent fine must be a number between 0 and 1,000,000 (or empty for no absent fine)" })
    }

    const policy = {}
    for (const [key, label, max] of POLICY_FIELDS) {
      if (req.body?.[key] === undefined) continue
      const value = req.body[key] === "" || req.body[key] === null ? 0 : Number(req.body[key])
      if (Number.isNaN(value) || value < 0 || value > max) {
        return res.status(400).json({ error: `${label} must be a number between 0 and ${max.toLocaleString()}` })
      }
      policy[key] = Math.round(value * 100) / 100
    }
    const current = await prisma.organization.findUnique({ where: { id: organizationId }, select: { halfDayMinimumHours: true, earlyGoingThresholdHours: true } })
    const minHours = policy.halfDayMinimumHours ?? Number(current?.halfDayMinimumHours ?? 0)
    const shortHours = policy.earlyGoingThresholdHours ?? Number(current?.earlyGoingThresholdHours ?? 0)
    if (minHours > 0 && shortHours > 0 && shortHours >= minHours) {
      return res.status(400).json({ error: "The very-short-day threshold must be lower than the minimum hours for a full day" })
    }

    const saved = await prisma.organization.update({
      where: { id: organizationId },
      data: { lateDeductionAmount: late, absentFineAmount: absent, ...policy },
    })
    const refreshed = await refreshAllDraftPayslips(organizationId)
    const settings = policySettings(saved)
    logAudit({
      organizationId, actorId: userId, action: "attendance.fine_settings",
      note: `Late PKR ${late} / day, absent ${absent === null ? "none" : `PKR ${absent} / day`}; half day when ${settings.lateHalfDayThresholdHours}h+ late or under ${settings.halfDayMinimumHours}h worked (${settings.halfDayDeductionPercent}% of a day); early going at ${settings.earlyGoingThresholdHours}h or less (fine PKR ${settings.earlyGoingFineAmount}) — ${refreshed} draft payslip(s) refreshed`,
    })
    res.json({ lateFine: late, absentFine: absent, ...settings, refreshedDrafts: refreshed })
  } catch (err) {
    next(err)
  }
}

// PUT /attendance/employee-note { employeeId, date, action: "seen"|"unseen"|"delete" }
// HR/ADMIN/CEO only (route). Acts on the note/extra hours the employee
// wrote on My Attendance: mark it seen (shows who), undo that, or delete it.
async function reviewEmployeeNote(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { employeeId, date, action } = req.body || {}
    if (!employeeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !["seen", "unseen", "delete"].includes(action)) {
      return res.status(400).json({ error: "employeeId, date (YYYY-MM-DD) and action (seen, unseen, delete) are required" })
    }
    const record = await prisma.attendanceRecord.findFirst({
      where: { employeeId, organizationId, date: toDateOnly(String(date)) },
      select: { id: true, employeeNote: true, extraMinutes: true },
    })
    if (!record || (!record.employeeNote && !record.extraMinutes)) return res.status(404).json({ error: "No employee note on this day" })

    const data =
      action === "delete" ? { employeeNote: null, extraMinutes: null, employeeNoteSeenAt: null, employeeNoteSeenById: null }
      : action === "seen" ? { employeeNoteSeenAt: new Date(), employeeNoteSeenById: userId }
      : { employeeNoteSeenAt: null, employeeNoteSeenById: null }
    const updated = await prisma.attendanceRecord.update({ where: { id: record.id }, data })
    if (action === "delete") {
      logAudit({ organizationId, actorId: userId, action: "attendance.employee_note_deleted", targetType: "User", targetId: employeeId, note: `${date}: ${String(record.employeeNote || "").slice(0, 200)}` })
    }
    const seenBy = updated.employeeNoteSeenById ? await prisma.user.findUnique({ where: { id: updated.employeeNoteSeenById }, select: { name: true } }) : null
    res.json({
      employeeId,
      date,
      employeeNote: updated.employeeNote,
      extraMinutes: updated.extraMinutes,
      employeeNoteSeenAt: updated.employeeNoteSeenAt?.toISOString() || null,
      employeeNoteSeenByName: seenBy?.name || null,
    })
  } catch (err) {
    next(err)
  }
}

async function markAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { employeeId, status, date } = req.body

    const validStatuses = ["PRESENT", "LATE", "ABSENT", "LEAVE"]
    if (!employeeId || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `employeeId and status (${validStatuses.join(", ")}) are required` })
    }

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, shiftStartDefault: true, lateThresholdMinutes: true } })
    const day = startOfDay(date, org?.timezone)
    const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: day } }, select: { checkInAt: true } })
    // Marking Present on a day with a recorded check-in still applies the
    // late rule — a 10:16 arrival on a 10:00 + 15 min shift stays LATE.
    const finalStatus = resolveArrivalStatus(status, existing?.checkInAt, employee, org)

    // An admin setting the status is an explicit decision (e.g. approving an
    // outside-premises check-in as Present). autoFlagged is left as-is: it
    // records *where* the employee checked in, which the decision doesn't
    // change, so the Attendance page keeps showing "Outside premises".
    const marked = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: { status: finalStatus, markedById: userId },
      create: { organizationId, employeeId, date: day, status: finalStatus, markedById: userId },
    })
    // An explicit Present on a flagged day re-derives Present/Late from the
    // check-in time (same as resolveArrivalStatus above).
    const record = await applyAttendanceEvaluation(prisma, marked.id, { recomputeStatus: ["PRESENT", "LATE"].includes(status) })
    await refreshDraftPayslip({ organizationId, employeeId, month: day.getUTCMonth() + 1, year: day.getUTCFullYear() }).catch(() => null)

    res.json(record)
  } catch (err) {
    next(err)
  }
}

async function saveDayAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { date, records } = req.body

    // LATE is accepted because the admin page sends each row's current
    // status back on Save — rejecting it made any day with a late arrival
    // impossible to save.
    const validStatuses = ["PRESENT", "LATE", "ABSENT", "LEAVE"]
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "records must be a non-empty array of { employeeId, status }" })
    }
    for (const r of records) {
      if (!r.employeeId || !validStatuses.includes(r.status)) {
        return res.status(400).json({ error: `Each record needs employeeId and status (${validStatuses.join(", ")})` })
      }
    }

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, shiftStartDefault: true, lateThresholdMinutes: true } })
    const day = startOfDay(date, org?.timezone)
    const employeeIds = records.map((r) => r.employeeId)
    const [employees, existing] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: employeeIds }, organizationId }, select: { id: true, shiftStart: true } }),
      prisma.attendanceRecord.findMany({ where: { employeeId: { in: employeeIds }, date: day }, select: { employeeId: true, checkInAt: true } }),
    ])
    const employeeById = new Map(employees.map((e) => [e.id, e]))
    const checkInByEmployee = new Map(existing.map((r) => [r.employeeId, r.checkInAt]))

    const results = await prisma.$transaction(
      records.map((r) => {
        const status = resolveArrivalStatus(r.status, checkInByEmployee.get(r.employeeId), employeeById.get(r.employeeId), org)
        return prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: r.employeeId, date: day } },
          // autoFlagged kept — see markAttendance.
          update: { status, markedById: userId },
          create: { organizationId, employeeId: r.employeeId, date: day, status, markedById: userId },
        })
      })
    )

    for (const [i, saved] of results.entries()) {
      await applyAttendanceEvaluation(prisma, saved.id, { recomputeStatus: ["PRESENT", "LATE"].includes(records[i].status) })
    }

    // Status changes move the late/absent fines — keep DRAFT payslips current.
    await Promise.all(
      records.map((r) =>
        refreshDraftPayslip({ organizationId, employeeId: r.employeeId, month: day.getUTCMonth() + 1, year: day.getUTCFullYear() }).catch(() => null)
      )
    )
    res.json({ date: day.toISOString().slice(0, 10), saved: results.length })
  } catch (err) {
    next(err)
  }
}

// NOTE: the mid-day "outside authorized site" auto-ABSENT flip used to live
// here, computed from continuous AttendancePresenceEvent samples. Continuous
// location tracking has been removed (attendance is now a one-shot geofence
// check at check-in/check-out only), so this function — and the "final
// status" it derived — no longer applies. Status now comes straight from the
// AttendanceRecord written at check-in/check-out time.

async function exportAttendanceSheet(req, res, next) {
  try {
    const { organizationId, role, departmentId } = req.user
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workingHoursPerDay: true, workingDaysPerWeek: true, workingDays: true, timezone: true, breakStart: true, breakEnd: true, shiftStartDefault: true, shiftEndDefault: true },
    })
    if (!organization) return res.status(404).json({ error: "Organization not found" })

    const tz = organization.timezone || "UTC"
    const requestedDate = req.query.date || dateKeyInTimeZone(new Date(), tz)
    // startDate/endDate is the documented range param; from/to and a bare
    // date are kept working for anything still calling the old shape.
    const from = req.query.startDate || req.query.from || requestedDate
    const to = req.query.endDate || req.query.to || requestedDate
    const format = String(req.query.format || "xlsx").toLowerCase()
    const fromDate = toDateOnly(from)
    const toDate = toDateOnly(to)
    const endExclusive = new Date(toDate)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

    const [employees, records, sites] = await Promise.all([
      prisma.user.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          ...(role === "DEPARTMENT_HEAD" ? { departmentId: departmentId || "__none__" } : {}),
        },
        include: { department: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({ where: { organizationId, date: { gte: fromDate, lt: endExclusive } }, orderBy: [{ date: "asc" }, { employeeId: "asc" }] }),
      prisma.attendanceSite.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ])
    const siteNameById = new Map(sites.map((s) => [s.id, s.name]))
    const byKey = new Map(records.map(r => [`${r.employeeId}|${r.date.toISOString().slice(0,10)}`, r]))
    // One row-array per calendar day so the xlsx branch below can give each
    // day its own worksheet — a multi-day export previously dumped every
    // day into one flat sheet, which made it awkward to hand a single
    // day's attendance to someone else without them scrolling/filtering.
    const rowsByDay = new Map()
    for (let d=new Date(fromDate); d<endExclusive; d.setUTCDate(d.getUTCDate()+1)) {
      const dateOnly=new Date(d)
      const dayKey=dateOnly.toISOString().slice(0,10)
      const dayRows=[]
      for (const emp of employees) {
        const record=byKey.get(`${emp.id}|${dayKey}`)
        dayRows.push({
          employee: emp.name, department: emp.department?.name || "", date: dayKey,
          status: record?.status || "ABSENT", site: (record?.siteId && siteNameById.get(record.siteId)) || "",
          locationMode: record?.locationMode || "",
          checkIn: formatTime12(record?.checkInAt, tz), checkOut: formatTime12(record?.checkOutAt, tz),
          workingMinutes: record?.workingMinutes ?? "",
          source: record?.source || "MANUAL", offline: record?.offlineRecorded ? "YES" : "NO",
          latitude: record?.latitude == null ? "" : Number(record.latitude), longitude: record?.longitude == null ? "" : Number(record.longitude),
          gpsAccuracy: record?.gpsAccuracy ?? "", distanceMeters: record?.distanceMeters ?? "",
        })
      }
      rowsByDay.set(dayKey, dayRows)
    }
    const rows = [...rowsByDay.values()].flat()

    if (format === "csv") {
      const headers=["Employee","Department","Date","Status","Site","Location Mode","Check In","Check Out","Working Minutes","Source","Offline","Latitude","Longitude","GPS Accuracy","Check-in Distance"]
      const esc=v=>`"${String(v ?? "").replace(/"/g,'""')}"`
      const csv=[headers, ...rows.map(r=>[r.employee,r.department,r.date,r.status,r.site,r.locationMode,r.checkIn,r.checkOut,r.workingMinutes,r.source,r.offline,r.latitude,r.longitude,r.gpsAccuracy,r.distanceMeters])].map(row=>row.map(esc).join(',')).join('\r\n')
      res.setHeader("Content-Type","text/csv; charset=utf-8")
      res.setHeader("Content-Disposition",`attachment; filename="Attendance_${from}_${to}.csv"`)
      return res.send("\ufeff"+csv)
    }

    const workbook=new ExcelJS.Workbook()
    workbook.creator="ManagementDock"
    const columns=[
      {header:"Employee",key:"employee",width:24},{header:"Department",key:"department",width:18},{header:"Date",key:"date",width:13},{header:"Status",key:"status",width:15},{header:"Site",key:"site",width:24},{header:"Location Mode",key:"locationMode",width:15},{header:"Check In",key:"checkIn",width:14},{header:"Check Out",key:"checkOut",width:14},{header:"Working Minutes",key:"workingMinutes",width:17},{header:"Source",key:"source",width:13},{header:"Offline",key:"offline",width:10},{header:"Latitude",key:"latitude",width:14},{header:"Longitude",key:"longitude",width:14},{header:"GPS Accuracy",key:"gpsAccuracy",width:15},{header:"Check-in Distance",key:"distanceMeters",width:18},
    ]
    // One sheet per calendar day, named by that day (e.g. "2026-09-17") —
    // a single-day export still yields exactly one sheet, unchanged from before.
    for (const [dayKey, dayRows] of rowsByDay) {
      const sheet=workbook.addWorksheet(dayKey)
      sheet.columns=columns
      dayRows.forEach(r=>sheet.addRow(r))
      sheet.getRow(1).font={bold:true}
      sheet.views=[{state:"frozen",ySplit:1}]
      sheet.autoFilter={from:"A1",to:`O${Math.max(1,dayRows.length+1)}`}
    }

    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition",`attachment; filename="Attendance_${from}_${to}.xlsx"`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

async function markSelfAttendance(req, res, next) {
  try {
    const { userId } = req.user
    const { status, latitude, longitude, siteId, locationMode } = req.body || {}
    if (!['PRESENT','ABSENT'].includes(status)) return res.status(400).json({ error: 'status must be one of: PRESENT, ABSENT' })
    const validLocationModes = ['OFFICE', 'FIELD', 'WFH']
    const mode = validLocationModes.includes(locationMode) ? locationMode : 'OFFICE'
    const isWfh = mode === 'WFH'

    // Self-attendance is always tied to the employee's real home
    // organization, never req.user.organizationId — applyOrganizationScope
    // can reassign that for the duration of a request when the caller is
    // viewing another organization (e.g. a cross-org IT_MANAGER browsing
    // inventory elsewhere), and their own attendance must still land
    // against their actual employer.
    const employee = await prisma.user.findUnique({ where: { id: userId }, select: { workLocationType:true, shiftStart:true, organizationId:true } })
    if (!employee) return res.status(404).json({ error: 'Employee or organization not found' })
    const organizationId = employee.organizationId
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { geofenceEnabled:true, officeLatitude:true, officeLongitude:true, geofenceRadiusMeters:true, shiftStartDefault:true, lateThresholdMinutes:true, timezone:true, breakStart:true, breakEnd:true } })
    if (!organization) return res.status(404).json({ error: 'Employee or organization not found' })
    const today=startOfDay(null, organization.timezone)
    const existing=await prisma.attendanceRecord.findUnique({ where:{ employeeId_date:{employeeId:userId,date:today} } })
    if (existing?.status==='LEAVE') return res.status(400).json({ error:'Today is already recorded as leave' })

    // An employee bound to an attendance site (directly or through the site's
    // project) must check in with a location: WFH is not offered to them. A
    // check-in from outside the premises (outside every assigned site, or
    // outside the office geofence for non-site employees) is still accepted
    // but recorded as LATE + autoFlagged, with the exact location kept and an
    // automatic day note, so HR can review it and mark Present if the
    // company allows it.
    const assignedSites=await findAssignedSites(prisma, organizationId, userId)
    const siteBound=assignedSites.length>0
    if (status==='PRESENT' && isWfh && siteBound) {
      return res.status(403).json({ error:`You are assigned to the attendance site "${assignedSites[0].name}". Work from home is not available — check in from inside the site.` })
    }

    // WFH skips the geofence check entirely — no location is required or used.
    const hasCoords=!isWfh && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    const isMobileDevice=/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(String(req.headers['user-agent']||''))
    if (status==='PRESENT' && siteBound && !hasCoords) return res.status(400).json({ error:'Location is required — you are assigned to an attendance site. Allow location access and try again.' })
    if (status==='PRESENT' && isMobileDevice && !hasCoords && !isWfh) return res.status(400).json({ error:'Location is required to mark attendance from a mobile or tablet' })

    let chosenSite=null, chosenDistance=null, chosenInside=false, outsideSite=false
    if (hasCoords && siteBound) {
      const match=matchAssignedSite(assignedSites, Number(latitude), Number(longitude))
      chosenSite=match.site; chosenDistance=match.distance; chosenInside=match.inside
      if (siteId) {
        const requested=assignedSites.find(s=>s.id===String(siteId))
        if (!requested) return res.status(403).json({ error:'The selected site is not assigned to you' })
        const result=siteDistance(requested, Number(latitude), Number(longitude))
        if (result.inside || !chosenInside) { chosenSite=requested; chosenDistance=result.distance; chosenInside=result.inside }
      }
      outsideSite=status==='PRESENT' && !match.eligible
    }

    const officeGeofenceActive=organization.geofenceEnabled && organization.officeLatitude!=null && organization.officeLongitude!=null && employee.workLocationType!=='FIELD'
    let outsideOffice=false
    if (status==='PRESENT' && !siteBound && officeGeofenceActive && hasCoords) {
      const distance=distanceMeters(Number(latitude),Number(longitude),Number(organization.officeLatitude),Number(organization.officeLongitude))
      chosenDistance=distance
      outsideOffice=distance > Number(organization.geofenceRadiusMeters)
    }
    const outsidePremises=outsideSite || outsideOffice

    let finalStatus=status, autoFlagged=false
    if (outsidePremises) {
      // Never overwrite a check-in that was already accepted today.
      if (existing?.checkInAt && existing.status!=='ABSENT') {
        return res.status(403).json({ error:'You are outside the office premises, and you have already checked in today.' })
      }
      finalStatus='LATE'
      autoFlagged=true
    }

    const now=new Date()
    if (status==='PRESENT' && !autoFlagged && isLateCheckIn(now, employee, organization)) finalStatus='LATE'
    const locationData=hasCoords
      ? {latitude:Number(latitude),longitude:Number(longitude),distanceMeters:chosenDistance==null?null:Math.round(chosenDistance),siteId:chosenSite?.id||null}
      : {latitude:null,longitude:null,distanceMeters:null,siteId:null}

    const checkInAt=now
    const upserted=await prisma.attendanceRecord.upsert({
      where:{employeeId_date:{employeeId:userId,date:today}},
      update:{status:finalStatus,markedById:userId,autoFlagged,checkInAt,locationMode:mode,...locationData},
      create:{organizationId,employeeId:userId,date:today,status:finalStatus,markedById:userId,autoFlagged,checkInAt,locationMode:mode,...locationData},
    })
    // Late minutes / half-day by late arrival, in the site's timezone.
    const record=await applyAttendanceEvaluation(prisma, upserted.id)
    refreshPayslipForDay(organizationId, userId, today)
    if (hasCoords) {
      const presenceId=`ape_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`
      await prisma.$executeRaw`
        INSERT INTO "AttendancePresenceEvent"
          ("id","organizationId","employeeId","attendanceId","siteId","eventType","recordedAt","latitude","longitude","gpsAccuracy","distanceMeters","inside","clientEventId","metadata")
        VALUES
          (${presenceId},${organizationId},${userId},${record.id},${chosenSite?.id||null},${chosenInside ? 'GEOFENCE_ENTER':'GEOFENCE_EXIT'},${now},${Number(latitude)},${Number(longitude)},${req.body?.gpsAccuracy!=null?Number(req.body.gpsAccuracy):null},${chosenDistance},${chosenSite ? chosenInside : null},${req.body?.clientEventId||null},${JSON.stringify({source:'CHECK_IN',siteName:chosenSite?.name||null})}::jsonb)
        ON CONFLICT ("clientEventId") WHERE "clientEventId" IS NOT NULL DO NOTHING
      `
    }
    let message=null
    if (outsidePremises) {
      const where=outsideSite ? chosenSite.name : 'the office'
      message=`You are ${Math.round(chosenDistance)}m outside ${outsideSite ? `your assigned site (${where})` : where}. Your attendance was recorded as LATE with your location; HR will review it.`
      await addOutsidePremisesNote(prisma, organizationId, userId, today, Math.round(chosenDistance), where)
      await prisma.$executeRaw`
        INSERT INTO "AttendanceAnomaly"
          ("id","organizationId","employeeId","attendanceId","siteId","type","severity","message","metadata")
        VALUES
          (${`an_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`},${organizationId},${userId},${record.id},${chosenSite?.id||null},'OUTSIDE_SITE','HIGH',
           ${`Checked in ${Math.round(chosenDistance)}m outside ${where} — recorded as LATE`},
           ${JSON.stringify({ distanceMeters: Math.round(chosenDistance), latitude: Number(latitude), longitude: Number(longitude) })}::jsonb)
      `
    }
    res.json({ ...record, requestedStatus:status, autoFlagged, outsideSite:outsidePremises, message, site:chosenSite ? {id:chosenSite.id,name:chosenSite.name,distanceMeters:Math.round(chosenDistance),radiusMeters:Number(chosenSite.radiusMeters),inside:chosenInside} : null })
  } catch(err) { next(err) }
}

// Employee self-service: their own recent attendance history.
async function getSelfAttendance(req, res, next) {
  try {
    const { userId } = req.user
    // Same reasoning as markSelfAttendance — always use the employee's real
    // home organization for their own timezone, not the switched-scope one.
    const employee = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } })
    const organization = employee
      ? await prisma.organization.findUnique({ where: { id: employee.organizationId }, select: { timezone: true } })
      : null
    const today = startOfDay(null, organization?.timezone)
    const since = new Date(today)
    since.setUTCDate(since.getUTCDate() - 30)

    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId: userId, date: { gte: since } },
      orderBy: { date: "desc" },
    })

    const todayRecord = records.find((r) => r.date.getTime() === today.getTime())
    res.json({ today: todayRecord || null, history: records, timezone: organization?.timezone || "UTC" })
  } catch (err) {
    next(err)
  }
}

const SELF_NOTE_DAYS = 7
const MAX_EXTRA_MINUTES = 12 * 60

// PUT /attendance/self/note — the employee's own note on one of their days
// (e.g. extra hours worked), with optional extraMinutes. Only on a day they
// checked in, within the last SELF_NOTE_DAYS. Stored on the record itself,
// separate from the HR/ADMIN/CEO day note, so neither overwrites the other.
async function setSelfAttendanceNote(req, res, next) {
  try {
    const { userId } = req.user
    const { date } = req.body || {}
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" })
    const text = String(req.body?.note ?? "").trim()
    if (text.length > NOTE_MAX_LENGTH) return res.status(400).json({ error: `Note must be ${NOTE_MAX_LENGTH} characters or fewer` })
    let extraMinutes = null
    if (req.body?.extraMinutes !== undefined && req.body.extraMinutes !== null && req.body.extraMinutes !== "") {
      extraMinutes = Math.round(Number(req.body.extraMinutes))
      if (!Number.isFinite(extraMinutes) || extraMinutes < 0 || extraMinutes > MAX_EXTRA_MINUTES) {
        return res.status(400).json({ error: "Extra time must be between 0 and 12 hours" })
      }
      if (extraMinutes === 0) extraMinutes = null
    }

    // Home organization, same as the other self-service endpoints.
    const employee = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } })
    const organization = employee && await prisma.organization.findUnique({ where: { id: employee.organizationId }, select: { timezone: true } })
    if (!organization) return res.status(404).json({ error: "Employee not found" })
    const today = startOfDay(null, organization.timezone)
    const day = toDateOnly(String(date))
    if (day > today || day.getTime() < today.getTime() - SELF_NOTE_DAYS * 86400000) {
      return res.status(400).json({ error: `You can add a note for today or the last ${SELF_NOTE_DAYS} days only` })
    }

    const record = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: userId, date: day } } })
    if (!record?.checkInAt) return res.status(400).json({ error: "You can only add a note on a day you checked in" })

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      // An edited note counts as new for HR again.
      data: { employeeNote: text || null, extraMinutes, employeeNoteSeenAt: null, employeeNoteSeenById: null },
    })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getDailyAttendance,
  setAttendanceNote,
  setAttendanceFine,
  setFineSettings,
  reviewEmployeeNote,
  setSelfAttendanceNote,
  markAttendance,
  saveDayAttendance,
  exportAttendanceSheet,
  markSelfAttendance,
  getSelfAttendance,
}


// Phase A: receive an offline queue from the employee device.
// The client event ID makes the operation idempotent.
async function syncOfflineAttendance(req, res, next) {
  try {
    const { userId } = req.user
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : []
    if (!events.length) return res.json({ synced: 0, duplicates: 0, rejected: [] })

    // Same reasoning as markSelfAttendance — always resolve the employee's
    // real home organization, not the switched-scope req.user.organizationId.
    const employee = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, shiftStart: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const organizationId = employee.organizationId

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        timezone: true,
        geofenceEnabled: true,
        officeLatitude: true,
        officeLongitude: true,
        geofenceRadiusMeters: true,
        shiftStartDefault: true,
        lateThresholdMinutes: true,
      },
    })

    const results = { synced: 0, duplicates: 0, rejected: [] }
    const touchedDays = new Set()

    for (const event of events) {
      const clientEventId = String(event?.clientEventId || "").trim()
      try {
        const status = event?.type === "CHECK_OUT" ? "CHECK_OUT" : event?.type === "CHECK_IN" ? "CHECK_IN" : event?.type === "GEOFENCE" ? "GEOFENCE" : null
        if (!clientEventId || !status || !event.localRecordedAt || !event.localDate) {
          throw new Error("Invalid offline attendance event")
        }

        const recordedAt = new Date(event.localRecordedAt)
        if (Number.isNaN(recordedAt.getTime())) throw new Error("Invalid recorded timestamp")
        const day = toDateOnly(String(event.localDate))
        const locationMode = ["OFFICE", "FIELD", "WFH"].includes(event.locationMode) ? event.locationMode : "OFFICE"
        const isWfh = locationMode === "WFH"
        // WFH skips the geofence check entirely, same as the online path.
        const hasCoords = !isWfh && Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))

        // Durable server-side idempotency journal. CHECK_IN and CHECK_OUT each
        // retain their own event ID instead of overwriting one AttendanceRecord ID.
        const journalId = `ase_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`
        const inserted = await prisma.$queryRaw`
          INSERT INTO "AttendanceSyncEvent"
            ("id","clientEventId","organizationId","employeeId","eventType","recordedAt","localDate","payload","status")
          VALUES
            (${journalId},${clientEventId},${organizationId},${userId},${status},${recordedAt},${day},${JSON.stringify(event)}::jsonb,'PENDING')
          ON CONFLICT ("clientEventId") DO NOTHING
          RETURNING "id","status"
        `

        if (!inserted.length) {
          const existing = await prisma.$queryRaw`
            SELECT "status" FROM "AttendanceSyncEvent" WHERE "clientEventId"=${clientEventId} LIMIT 1
          `
          if (existing[0]?.status === "PROCESSED") {
            results.duplicates += 1
            continue
          }
          // If another request is already processing this exact event, do not
          // process it twice. A stale PROCESSING row can be reclaimed below.
          const reclaimed = await prisma.$queryRaw`
            UPDATE "AttendanceSyncEvent"
            SET "status"='PROCESSING', "updatedAt"=CURRENT_TIMESTAMP, "lastError"=NULL
            WHERE "clientEventId"=${clientEventId}
              AND ("status" IN ('PENDING','FAILED') OR ("status"='PROCESSING' AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
            RETURNING "id"
          `
          if (!reclaimed.length) {
            results.duplicates += 1
            continue
          }
        } else {
          await prisma.$executeRaw`
            UPDATE "AttendanceSyncEvent"
            SET "status"='PROCESSING', "updatedAt"=CURRENT_TIMESTAMP
            WHERE "clientEventId"=${clientEventId}
          `
        }

        try {
          let evaluateId = null
          await prisma.$transaction(async (tx) => {
            let siteId = event.siteId ? String(event.siteId) : null
            let distance = null
            let anomaly = null
            let outsideSite = false
            let outsideSiteName = null

            // Same site-bound rules as markSelfAttendance: no WFH, location
            // required, and an outside check-in is recorded as LATE +
            // autoFlagged with an automatic note for HR to review.
            const assignedSites = status === "CHECK_IN" || status === "CHECK_OUT" ? await findAssignedSites(tx, organizationId, userId) : []
            if (status === "CHECK_IN" && assignedSites.length) {
              if (isWfh) throw new Error(`Work from home is not available — you are assigned to the attendance site "${assignedSites[0].name}"`)
              if (!hasCoords) throw new Error("Location is required — you are assigned to an attendance site")
            }

            if (hasCoords) {
              const assigned = assignedSites
              const best = assigned.length ? matchAssignedSite(assigned, Number(event.latitude), Number(event.longitude)) : null
              if (siteId && !assigned.some(s=>s.id===siteId)) throw new Error("Attendance site is not assigned to this employee")
              if (best) {
                siteId=best.site.id
                distance=best.distance
                const inside=best.inside
                if (status === "CHECK_IN" && !best.eligible) {
                  outsideSite = true
                } else if (status === "CHECK_OUT" && best.site.geofenceMode === "STRICT" && !inside) {
                  throw new Error(`Outside all assigned site geofences (${Math.round(distance)}m from nearest site)`)
                }
                if (outsideSite) outsideSiteName = best.site.name
                if (!inside) anomaly={type:"OUTSIDE_SITE",severity:"HIGH",message:outsideSite
                  ? `Checked in ${Math.round(distance)}m outside assigned site (${best.site.name}) — recorded as LATE`
                  : `Attendance location is ${Math.round(distance)}m from nearest assigned site (${best.site.name})`}
              } else if (status === "CHECK_IN") {
                throw new Error("No active attendance site is assigned to this employee")
              }
            }

            let attendance = await tx.attendanceRecord.findUnique({
              where: { employeeId_date: { employeeId: userId, date: day } },
            })

            if (status === "GEOFENCE") {
              const assigned = await tx.$queryRaw`
                SELECT DISTINCT s.* FROM "AttendanceSite" s
                LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${userId}
                WHERE s."organizationId"=${organizationId} AND s.active=TRUE
                  AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${userId}))
              `
              let best=null
              for (const site of assigned) {
                const result=hasCoords ? siteDistance(site, Number(event.latitude), Number(event.longitude)) : null
                if (result && (!best || (result.inside && !best.inside) || (result.inside === best.inside && result.distance < best.distance))) best={site,distance:result.distance,inside:result.inside}
              }
              const inside=best ? best.inside : false
              await tx.$executeRaw`
                INSERT INTO "AttendancePresenceEvent"
                  ("id","organizationId","employeeId","attendanceId","siteId","eventType","recordedAt","latitude","longitude","gpsAccuracy","distanceMeters","inside","clientEventId","metadata")
                VALUES
                  (${`ape_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`},${organizationId},${userId},${attendance?.id || null},${best?.site?.id || null},${inside ? "GEOFENCE_ENTER" : "GEOFENCE_EXIT"},${recordedAt},${hasCoords ? Number(event.latitude) : null},${hasCoords ? Number(event.longitude) : null},${event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null},${best?.distance ?? null},${inside},${clientEventId},${JSON.stringify({source:"OFFLINE",siteName:best?.site?.name||null})}::jsonb)
                ON CONFLICT ("clientEventId") WHERE "clientEventId" IS NOT NULL DO NOTHING
              `
            } else if (status === "CHECK_IN") {
              let finalStatus = isLateCheckIn(recordedAt, employee, org) ? "LATE" : "PRESENT"
              if (outsideSite) {
                if (attendance?.checkInAt && attendance.status !== "ABSENT") throw new Error("Outside the assigned site, and already checked in for this day")
                finalStatus = "LATE"
                await addOutsidePremisesNote(tx, organizationId, userId, day, Math.round(distance), outsideSiteName)
              }
              const checkInAt = recordedAt
              const roundedDistance = distance == null ? null : Math.round(distance)

              const verificationHash = crypto
                .createHash("sha256")
                .update(JSON.stringify({
                  organizationId, userId, day: event.localDate, recordedAt: recordedAt.toISOString(),
                  latitude: hasCoords ? Number(event.latitude) : null,
                  longitude: hasCoords ? Number(event.longitude) : null,
                  siteId, clientEventId,
                }))
                .digest("hex")

              attendance = await tx.attendanceRecord.upsert({
                where: { employeeId_date: { employeeId: userId, date: day } },
                update: {
                  status: finalStatus,
                  markedById: userId,
                  autoFlagged: outsideSite,
                  checkInAt,
                  locationMode,
                  latitude: hasCoords ? Number(event.latitude) : null,
                  longitude: hasCoords ? Number(event.longitude) : null,
                  distanceMeters: roundedDistance,
                },
                create: {
                  organizationId,
                  employeeId: userId,
                  date: day,
                  status: finalStatus,
                  markedById: userId,
                  autoFlagged: outsideSite,
                  checkInAt,
                  locationMode,
                  latitude: hasCoords ? Number(event.latitude) : null,
                  longitude: hasCoords ? Number(event.longitude) : null,
                  distanceMeters: roundedDistance,
                },
              })

              await tx.$executeRaw`
                UPDATE "AttendanceRecord"
                SET "siteId"=${siteId},
                    "offlineRecorded"=TRUE,
                    "localRecordedAt"=${recordedAt},
                    "syncedAt"=CURRENT_TIMESTAMP,
                    "clientEventId"=${clientEventId},
                    "gpsAccuracy"=${event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null},
                    "networkType"=${event.networkType || "offline"},
                    "attendanceDeviceId"=${event.deviceId || null},
                    "verificationHash"=${verificationHash}
                WHERE id=${attendance.id}
              `
            } else {
              if (!attendance?.checkInAt) throw new Error("Cannot check out offline before a check-in exists")

              await tx.$executeRaw`
                UPDATE "AttendanceRecord"
                SET "checkOutAt"=${recordedAt},
                    "autoCheckedOut"=FALSE,
                    "offlineRecorded"=TRUE,
                    "localRecordedAt"=COALESCE("localRecordedAt", ${recordedAt}),
                    "syncedAt"=CURRENT_TIMESTAMP,
                    "gpsAccuracy"=${event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null},
                    "networkType"=${event.networkType || "offline"},
                    "attendanceDeviceId"=${event.deviceId || null}
                WHERE id=${attendance.id}
              `
            }

            // Evaluated after the commit (keeps this transaction short).
            if (attendance && (status === "CHECK_IN" || status === "CHECK_OUT")) evaluateId = attendance.id

            if (anomaly) {
              await tx.$executeRaw`
                INSERT INTO "AttendanceAnomaly"
                  ("id","organizationId","employeeId","attendanceId","siteId","type","severity","message","metadata")
                VALUES
                  (${`an_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`},
                   ${organizationId},${userId},${attendance.id},${siteId},${anomaly.type},${anomaly.severity},
                   ${anomaly.message},${JSON.stringify({ distanceMeters: distance })}::jsonb)
              `
            }

            await tx.$executeRaw`
              UPDATE "AttendanceSyncEvent"
              SET "status"='PROCESSED', "processedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP, "lastError"=NULL
              WHERE "clientEventId"=${clientEventId}
            `
          })

          // Late / half-day / early-going result for the day (attendance engine).
          if (evaluateId) {
            await applyAttendanceEvaluation(prisma, evaluateId)
            touchedDays.add(String(event.localDate).slice(0, 10))
          }
          results.synced += 1
        } catch (processingError) {
          await prisma.$executeRaw`
            UPDATE "AttendanceSyncEvent"
            SET "status"='FAILED', "lastError"=${String(processingError.message || "Attendance sync failed").slice(0, 1000)}, "updatedAt"=CURRENT_TIMESTAMP
            WHERE "clientEventId"=${clientEventId}
          `
          throw processingError
        }
      } catch (eventError) {
        results.rejected.push({ clientEventId: clientEventId || null, error: eventError.message })
      }
    }

    for (const key of touchedDays) await refreshPayslipForDay(organizationId, userId, key)
    res.json(results)
  } catch (err) {
    next(err)
  }
}

async function getAttendanceAnomalies(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    const rows = await prisma.$queryRaw`
      SELECT a.*, u.name AS "employeeName", s.name AS "siteName"
      FROM "AttendanceAnomaly" a
      LEFT JOIN "User" u ON u.id=a."employeeId"
      LEFT JOIN "AttendanceSite" s ON s.id=a."siteId"
      WHERE a."organizationId"=${req.user.organizationId}
        AND a."resolvedAt" IS NULL
      ORDER BY
        CASE a.severity WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        a."createdAt" DESC
      LIMIT ${limit}
    `
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

async function resolveAttendanceAnomaly(req, res, next) {
  try {
    const { id } = req.params
    const rows = await prisma.$queryRaw`
      SELECT id FROM "AttendanceAnomaly"
      WHERE id=${id} AND "organizationId"=${req.user.organizationId}
    `
    if (!rows.length) return res.status(404).json({ error: "Anomaly not found" })
    await prisma.$executeRaw`
      UPDATE "AttendanceAnomaly"
      SET "resolvedAt"=CURRENT_TIMESTAMP, "resolvedById"=${req.user.userId}
      WHERE id=${id}
    `
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

async function createAttendanceCorrection(req, res, next) {
  try {
    const { userId } = req.user
    const { requestedCheckInAt, requestedCheckOutAt, reason, attendanceId } = req.body
    if (!String(reason || "").trim()) return res.status(400).json({ error: "A reason is required" })
    const checkIn = requestedCheckInAt ? new Date(requestedCheckInAt) : null
    const checkOut = requestedCheckOutAt ? new Date(requestedCheckOutAt) : null
    if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime()))) {
      return res.status(400).json({ error: "Requested times are not valid dates" })
    }
    if (!checkIn && !checkOut) return res.status(400).json({ error: "Give the correct check-in and/or check-out time" })
    if (checkIn && checkOut && checkOut <= checkIn) return res.status(400).json({ error: "Check-out must be after check-in" })
    // Same reasoning as markSelfAttendance — always resolve the employee's
    // real home organization, not the switched-scope req.user.organizationId.
    const employee = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const organizationId = employee.organizationId
    // A correction may only point at the employee's own record — approving
    // it rewrites that record's times.
    if (attendanceId) {
      const own = await prisma.attendanceRecord.findFirst({ where: { id: attendanceId, employeeId: userId }, select: { id: true } })
      if (!own) return res.status(404).json({ error: "Attendance record not found" })
      const pending = await prisma.$queryRaw`
        SELECT id FROM "AttendanceCorrection" WHERE "attendanceId"=${attendanceId} AND status='PENDING' LIMIT 1
      `
      if (pending.length) return res.status(409).json({ error: "A correction for this day is already waiting for review" })
    }
    const correctionId = `cor_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`
    await prisma.$executeRaw`
      INSERT INTO "AttendanceCorrection"
        ("id","organizationId","employeeId","attendanceId","requestedCheckInAt","requestedCheckOutAt","reason")
      VALUES
        (${correctionId},${organizationId},${userId},${attendanceId || null},
         ${checkIn},
         ${checkOut},
         ${String(reason).trim().slice(0, 1000)})
    `
    notifyManagement({
      organizationId,
      createdById: userId,
      type: "REQUEST",
      title: "Attendance correction request",
      message: String(reason).trim().slice(0, 200),
      link: "/attendance",
      moduleKey: "attendance",
    }).catch(() => {})
    res.status(201).json({ id: correctionId, status: "PENDING" })
  } catch (err) {
    next(err)
  }
}

// GET /attendance/corrections[?status=PENDING] — newest first. A
// DEPARTMENT_HEAD only sees their own department (same as the daily grid).
async function listAttendanceCorrections(req, res, next) {
  try {
    const { organizationId, role, departmentId } = req.user
    const status = ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status) ? req.query.status : null
    const deptOnly = role === "DEPARTMENT_HEAD" ? departmentId || "__none__" : null
    const rows = await prisma.$queryRaw`
      SELECT c.*, u.name AS "employeeName", r.date, r."checkInAt", r."checkOutAt", r.status AS "recordStatus",
             rb.name AS "requestedByName", rb.role::text AS "requestedByRole"
      FROM "AttendanceCorrection" c
      JOIN "User" u ON u.id=c."employeeId"
      LEFT JOIN "User" rb ON rb.id=c."requestedById"
      LEFT JOIN "AttendanceRecord" r ON r.id=c."attendanceId"
      WHERE c."organizationId"=${organizationId}
        AND (${status}::text IS NULL OR c.status=${status})
        AND (${deptOnly}::text IS NULL OR u."departmentId"=${deptOnly})
      ORDER BY c."createdAt" DESC
      LIMIT 100
    `
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

// GET /attendance/self/corrections — the employee's own requests.
async function listSelfAttendanceCorrections(req, res, next) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.id, c."attendanceId", c."requestedCheckInAt", c."requestedCheckOutAt", c.reason, c.status,
             c."reviewNote", c."createdAt", r.date
      FROM "AttendanceCorrection" c
      LEFT JOIN "AttendanceRecord" r ON r.id=c."attendanceId"
      WHERE c."employeeId"=${req.user.userId}
      ORDER BY c."createdAt" DESC
      LIMIT 20
    `
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

// PATCH /attendance/corrections/:id  { decision: "APPROVED"|"REJECTED", note }
// Approving writes the requested times onto the employee's existing
// attendance record for that day (or creates the day's record when there was
// none — the employee_date unique key means there is never a second one),
// re-applies the late rule and recomputes worked minutes. Payroll reads
// these same records, so the next Generate picks the correction up.
async function reviewAttendanceCorrection(req, res, next) {
  try {
    const { organizationId, userId, role, departmentId } = req.user
    const decision = req.body?.decision
    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVED or REJECTED" })
    }
    const reviewNote = String(req.body?.note || "").trim().slice(0, 1000) || null

    const [correction] = await prisma.$queryRaw`
      SELECT c.*, u."departmentId" FROM "AttendanceCorrection" c
      JOIN "User" u ON u.id=c."employeeId"
      WHERE c.id=${req.params.id} AND c."organizationId"=${organizationId}
    `
    if (!correction || (role === "DEPARTMENT_HEAD" && correction.departmentId !== departmentId)) {
      return res.status(404).json({ error: "Correction not found" })
    }
    if (correction.status !== "PENDING") return res.status(400).json({ error: "This correction has already been reviewed" })
    if (correction.employeeId === userId || correction.requestedById === userId) return res.status(403).json({ error: "You can't review your own correction" })

    let attendanceId = correction.attendanceId
    if (decision === "APPROVED") {
      const [org, employee] = await Promise.all([
        prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, shiftStartDefault: true, lateThresholdMinutes: true } }),
        prisma.user.findUnique({ where: { id: correction.employeeId }, select: { shiftStart: true } }),
      ])
      const existing = attendanceId ? await prisma.attendanceRecord.findUnique({ where: { id: attendanceId } }) : null
      const anchor = correction.requestedCheckInAt || correction.requestedCheckOutAt
      const day = existing ? existing.date : toDateOnly(dateKeyInTimeZone(new Date(anchor), org?.timezone || "UTC"))
      const current = existing || await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: correction.employeeId, date: day } } })

      const checkInAt = correction.requestedCheckInAt || current?.checkInAt || null
      const checkOutAt = correction.requestedCheckOutAt || current?.checkOutAt || null
      if (checkInAt && checkOutAt && new Date(checkOutAt) <= new Date(checkInAt)) {
        return res.status(400).json({ error: "The corrected check-out would be before the check-in — reject it or ask for a new request" })
      }
      // A worked day: PRESENT/LATE from the (corrected) check-in time.
      const baseStatus = current && current.status !== "ABSENT" ? current.status : "PRESENT"
      const status = resolveArrivalStatus(baseStatus === "LEAVE" ? "PRESENT" : baseStatus, checkInAt, employee, org)
      const workingMinutes = checkInAt && checkOutAt ? Math.round((new Date(checkOutAt) - new Date(checkInAt)) / 60000) : null
      const data = {
        checkInAt,
        checkOutAt,
        status,
        workingMinutes,
        markedById: userId,
        ...(correction.requestedCheckOutAt ? { autoCheckedOut: false } : {}),
      }
      const record = await prisma.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: correction.employeeId, date: day } },
        update: data,
        create: { organizationId, employeeId: correction.employeeId, date: day, ...data },
      })
      await applyAttendanceEvaluation(prisma, record.id, { recomputeStatus: true })
      attendanceId = record.id
      await refreshDraftPayslip({ organizationId, employeeId: correction.employeeId, month: day.getUTCMonth() + 1, year: day.getUTCFullYear() }).catch(() => null)
    }

    await prisma.$executeRaw`
      UPDATE "AttendanceCorrection"
      SET status=${decision}, "reviewedById"=${userId}, "reviewNote"=${reviewNote},
          "attendanceId"=${attendanceId}, "updatedAt"=CURRENT_TIMESTAMP
      WHERE id=${correction.id}
    `
    createNotification({
      organizationId,
      recipientId: correction.employeeId,
      createdById: userId,
      type: "INFO",
      title: decision === "APPROVED" ? "Attendance correction approved" : "Attendance correction rejected",
      message: reviewNote,
      link: "/attendance/me",
    }).catch(() => {})
    // A Site Admin who sent it on the employee's behalf hears back too.
    if (correction.requestedById && correction.requestedById !== correction.employeeId) {
      createNotification({
        organizationId,
        recipientId: correction.requestedById,
        createdById: userId,
        type: "INFO",
        title: decision === "APPROVED" ? "Attendance correction approved" : "Attendance correction rejected",
        message: reviewNote,
        link: "/site-attendance",
      }).catch(() => {})
    }
    res.json({ id: correction.id, status: decision, attendanceId })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  ...module.exports,
  syncOfflineAttendance,
  getAttendanceAnomalies,
  resolveAttendanceAnomaly,
  createAttendanceCorrection,
  listAttendanceCorrections,
  listSelfAttendanceCorrections,
  reviewAttendanceCorrection,
}
