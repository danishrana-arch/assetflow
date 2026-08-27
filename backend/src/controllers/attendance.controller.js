const prisma = require("../lib/prisma")
const ExcelJS = require("exceljs")
const { toDateOnly } = require("../utils/date")
const { workingMinutesPerDay, expectedWeeklyMinutes, isScheduledWorkday } = require("../utils/work-schedule")
const { distanceMeters } = require("../utils/geo")

function startOfDay(dateStr) {
  return toDateOnly(dateStr || new Date())
}

async function getDailyAttendance(req, res, next) {
  try {
    const { organizationId } = req.user
    const date = startOfDay(req.query.date)

    const [organization, employees, records] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          workingHoursPerDay: true,
          workingDaysPerWeek: true,
          geofenceEnabled: true,
          officeLatitude: true,
          officeLongitude: true,
          geofenceRadiusMeters: true,
        },
      }),
      prisma.user.findMany({
        where: { organizationId, status: "ACTIVE" },
        include: { department: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({
        where: { organizationId, date },
        include: { markedBy: true },
      }),
    ])

    const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]))

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
        workingMinutes: record?.workingMinutes ?? null,
        expectedWorkingMinutes: workingMinutesPerDay(organization),
        expectedWeeklyMinutes: expectedWeeklyMinutes(organization),
        isScheduledWorkday: isScheduledWorkday(date, organization),
        source: record?.source || "MANUAL",
        markedByName: record?.markedBy?.name || null,
        workLocationType: emp.workLocationType || "OFFICE",
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
      },
      rows,
    })
  } catch (err) {
    next(err)
  }
}

async function markAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { employeeId, status, date } = req.body

    const validStatuses = ["PRESENT", "ABSENT", "LEAVE"]
    if (!employeeId || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `employeeId and status (${validStatuses.join(", ")}) are required` })
    }

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const day = startOfDay(date)

    // An admin setting the status directly is an explicit override — any
    // prior "auto-flagged as absent due to location" marker no longer
    // applies, since a human has now made the call.
    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: day } },
      update: { status, markedById: userId, autoFlagged: false },
      create: { organizationId, employeeId, date: day, status, markedById: userId },
    })

    res.json(record)
  } catch (err) {
    next(err)
  }
}

async function saveDayAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { date, records } = req.body

    const validStatuses = ["PRESENT", "ABSENT", "LEAVE"]
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "records must be a non-empty array of { employeeId, status }" })
    }
    for (const r of records) {
      if (!r.employeeId || !validStatuses.includes(r.status)) {
        return res.status(400).json({ error: `Each record needs employeeId and status (${validStatuses.join(", ")})` })
      }
    }

    const day = startOfDay(date)

    const results = await prisma.$transaction(
      records.map((r) =>
        prisma.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: r.employeeId, date: day } },
          update: { status: r.status, markedById: userId, autoFlagged: false },
          create: { organizationId, employeeId: r.employeeId, date: day, status: r.status, markedById: userId },
        })
      )
    )

    res.json({ date: day.toISOString().slice(0, 10), saved: results.length })
  } catch (err) {
    next(err)
  }
}

async function exportAttendanceSheet(req, res, next) {
  try {
    const { organizationId } = req.user
    const date = startOfDay(req.query.date)

    const [organization, employees, records] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { workingHoursPerDay: true, workingDaysPerWeek: true } }),
      prisma.user.findMany({
        where: { organizationId, status: "ACTIVE" },
        include: { department: true },
        orderBy: { name: "asc" },
      }),
      prisma.attendanceRecord.findMany({ where: { organizationId, date } }),
    ])

    const recordByEmployee = new Map(records.map((r) => [r.employeeId, r]))
    const dateLabel = date.toISOString().slice(0, 10)

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet(`Attendance ${dateLabel}`)
    sheet.columns = [
      { header: "Employee", key: "name", width: 26 },
      { header: "Department", key: "department", width: 20 },
      { header: "Status", key: "status", width: 14 },
      { header: "Check In", key: "checkInAt", width: 22 },
      { header: "Check Out", key: "checkOutAt", width: 22 },
      { header: "Working Minutes", key: "workingMinutes", width: 18 },
      { header: "Expected Minutes", key: "expectedMinutes", width: 18 },
    ]
    sheet.getRow(1).font = { bold: true }

    employees.forEach((emp) => {
      const record = recordByEmployee.get(emp.id)
      sheet.addRow({
        name: emp.name,
        department: emp.department?.name || "",
        status: record?.status || "ABSENT",
        checkInAt: record?.checkInAt ? record.checkInAt.toISOString() : "",
        checkOutAt: record?.checkOutAt ? record.checkOutAt.toISOString() : "",
        workingMinutes: record?.workingMinutes ?? "",
        expectedMinutes: workingMinutesPerDay(organization),
      })
    })

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition", `attachment filename="Attendance_${dateLabel}.xlsx"`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    next(err)
  }
}

async function markSelfAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { status, latitude, longitude } = req.body

    const validStatuses = ["PRESENT", "ABSENT"]
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` })
    }

    const today = startOfDay()

    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: userId, date: today } },
    })
    if (existing?.status === "LEAVE") {
      return res.status(400).json({ error: "Today is already recorded as leave" })
    }

    const [organization, employee] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { geofenceEnabled: true, officeLatitude: true, officeLongitude: true, geofenceRadiusMeters: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { workLocationType: true } }),
    ])

    const hasCoords = typeof latitude === "number" && typeof longitude === "number"
    const isMobileDevice = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(String(req.headers["user-agent"] || ""))
    if (status === "PRESENT" && isMobileDevice && !hasCoords) {
      return res.status(400).json({ error: "Location is required to mark attendance from a mobile or tablet" })
    }
    const geofenceActive =
      organization?.geofenceEnabled &&
      organization.officeLatitude != null &&
      organization.officeLongitude != null &&
      employee?.workLocationType !== "FIELD"

    let finalStatus = status
    let autoFlagged = false
    let distance = null

    // Only the "Mark Present" attempt is subject to the geofence — marking
    // yourself Absent never needs a location check. FIELD-type employees
    // (those who work outside the office) are exempt entirely, but their
    // location is still recorded when available so admins have context.
    if (status === "PRESENT" && geofenceActive && hasCoords) {
      distance = distanceMeters(
        latitude,
        longitude,
        Number(organization.officeLatitude),
        Number(organization.officeLongitude)
      )
      if (distance > organization.geofenceRadiusMeters) {
        finalStatus = "ABSENT"
        autoFlagged = true
      }
    }

    const locationData = hasCoords
      ? { latitude, longitude, distanceMeters: distance }
      : { latitude: null, longitude: null, distanceMeters: null }

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: userId, date: today } },
      update: { status: finalStatus, markedById: userId, autoFlagged, ...locationData },
      create: { organizationId, employeeId: userId, date: today, status: finalStatus, markedById: userId, autoFlagged, ...locationData },
    })

    res.json({ ...record, requestedStatus: status, autoFlagged })
  } catch (err) {
    next(err)
  }
}

// Employee self-service: their own recent attendance history.
async function getSelfAttendance(req, res, next) {
  try {
    const { userId } = req.user
    const since = new Date()
    since.setDate(since.getDate() - 30)
    since.setHours(0, 0, 0, 0)

    const records = await prisma.attendanceRecord.findMany({
      where: { employeeId: userId, date: { gte: since } },
      orderBy: { date: "desc" },
    })

    const today = startOfDay()
    const todayRecord = records.find((r) => r.date.getTime() === today.getTime())

    res.json({ today: todayRecord || null, history: records })
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getDailyAttendance,
  markAttendance,
  saveDayAttendance,
  exportAttendanceSheet,
  markSelfAttendance,
  getSelfAttendance,
}
