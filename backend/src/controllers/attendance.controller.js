const crypto = require("crypto")
const prisma = require("../lib/prisma")
const ExcelJS = require("exceljs")
const { toDateOnly } = require("../utils/date")
const { workingMinutesPerDay, expectedWeeklyMinutes, isScheduledWorkday } = require("../utils/work-schedule")
const { distanceMeters } = require("../utils/geo")
const { dateKeyInTimeZone, localMinutes, parseHHMM } = require("../utils/timezone")

function startOfDay(dateStr, timeZone) {
  if (dateStr) return toDateOnly(dateStr)
  return toDateOnly(dateKeyInTimeZone(new Date(), timeZone || "UTC"))
}

async function getDailyAttendance(req, res, next) {
  try {
    const { organizationId } = req.user
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          workingHoursPerDay: true,
          workingDaysPerWeek: true,
          geofenceEnabled: true,
          officeLatitude: true,
          officeLongitude: true,
          geofenceRadiusMeters: true,
          timezone: true,
          breakStart: true,
          breakEnd: true,
        },
      })
    const date = startOfDay(req.query.date, organization?.timezone)

    const [employees, records] = await Promise.all([
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
        timezone: organization?.timezone || "UTC",
        breakStart: organization?.breakStart || null,
        breakEnd: organization?.breakEnd || null,
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

    const day = startOfDay(date, (await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }))?.timezone)

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

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
    const day = startOfDay(date, org?.timezone)

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
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { workingHoursPerDay: true, workingDaysPerWeek: true, timezone: true } })
    const date = startOfDay(req.query.date, organization?.timezone)

    const [employees, records] = await Promise.all([
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

    const [organization, employee] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: { geofenceEnabled: true, officeLatitude: true, officeLongitude: true, geofenceRadiusMeters: true, shiftStartDefault: true, lateThresholdMinutes: true, timezone: true, breakStart: true, breakEnd: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { workLocationType: true, shiftStart: true } }),
    ])

    const today = startOfDay(null, organization?.timezone)
    const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: userId, date: today } } })
    if (existing?.status === "LEAVE") return res.status(400).json({ error: "Today is already recorded as leave" })

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

    // Determine check-in time and lateness
    const now = new Date()
    const shiftStartStr = (employee?.shiftStart && employee.shiftStart.trim()) || organization?.shiftStartDefault || "09:00"
    const lateThreshold = Number.isFinite(Number(organization?.lateThresholdMinutes)) ? Number(organization.lateThresholdMinutes) : 15
    const checkInMinutes = localMinutes(now, organization?.timezone || "UTC")
    const shiftStartMinutes = parseHHMM(shiftStartStr)
    if (status === "PRESENT") {
      if (checkInMinutes > shiftStartMinutes + lateThreshold) {
        finalStatus = "LATE"
      }
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: userId, date: today } },
      update: { status: finalStatus, markedById: userId, autoFlagged, checkInAt: now, ...locationData },
      create: { organizationId, employeeId: userId, date: today, status: finalStatus, markedById: userId, autoFlagged, checkInAt: now, ...locationData },
    })

    res.json({ ...record, requestedStatus: status, autoFlagged })
  } catch (err) {
    next(err)
  }
}

// Employee self-service: their own recent attendance history.
async function getSelfAttendance(req, res, next) {
  try {
    const { userId, organizationId } = req.user
    const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } })
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

module.exports = {
  getDailyAttendance,
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
    const { organizationId, userId } = req.user
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : []
    if (!events.length) return res.json({ synced: 0, duplicates: 0, rejected: [] })

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

    for (const event of events) {
      try {
        const clientEventId = String(event.clientEventId || "").trim()
        const status = event.type === "CHECK_OUT" ? "CHECK_OUT" : "CHECK_IN"
        if (!clientEventId || !event.localRecordedAt || !event.localDate) {
          throw new Error("Invalid offline event")
        }

        const existing = await prisma.$queryRaw`
          SELECT id FROM "AttendanceRecord"
          WHERE "clientEventId"=${clientEventId}
          LIMIT 1
        `
        if (existing.length) {
          results.duplicates += 1
          continue
        }

        const recordedAt = new Date(event.localRecordedAt)
        if (Number.isNaN(recordedAt.getTime())) throw new Error("Invalid recorded timestamp")

        const day = toDateOnly(String(event.localDate))
        const hasCoords = Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))
        let siteId = event.siteId ? String(event.siteId) : null
        let distance = null
        let anomaly = null

        if (siteId) {
          const sites = await prisma.$queryRaw`
            SELECT * FROM "AttendanceSite"
            WHERE id=${siteId} AND "organizationId"=${organizationId} AND active=TRUE
            LIMIT 1
          `
          if (!sites.length) siteId = null
          else if (hasCoords) {
            const site = sites[0]
            distance = distanceMeters(
              Number(event.latitude), Number(event.longitude),
              Number(site.latitude), Number(site.longitude)
            )
            if (site.geofenceMode === "STRICT" && distance > Number(site.radiusMeters) && status === "CHECK_IN") {
              throw new Error(`Outside assigned site geofence (${distance}m)`)
            }
            if (distance > Number(site.radiusMeters)) {
              anomaly = {
                type: "OUTSIDE_SITE",
                severity: "HIGH",
                message: `Attendance recorded ${distance}m from ${site.name}`,
              }
            }
          }
        }

        let attendance = await prisma.attendanceRecord.findUnique({
          where: { employeeId_date: { employeeId: userId, date: day } },
        })

        if (status === "CHECK_IN") {
          let finalStatus = "PRESENT"
          const shiftStartStr = (event.shiftStart || org?.shiftStartDefault || "09:00")
          const threshold = Number(org?.lateThresholdMinutes || 15)
          const mins = localMinutes(recordedAt, org?.timezone || "UTC")
          const shiftMins = parseHHMM(shiftStartStr)
          if (mins > shiftMins + threshold) finalStatus = "LATE"

          const verificationHash = crypto
            .createHash("sha256")
            .update(JSON.stringify({
              organizationId, userId, day: event.localDate, recordedAt: recordedAt.toISOString(),
              latitude: hasCoords ? Number(event.latitude) : null,
              longitude: hasCoords ? Number(event.longitude) : null,
              siteId, clientEventId,
            }))
            .digest("hex")

          attendance = await prisma.attendanceRecord.upsert({
            where: { employeeId_date: { employeeId: userId, date: day } },
            update: {
              status: finalStatus,
              markedById: userId,
              checkInAt: recordedAt,
              latitude: hasCoords ? Number(event.latitude) : null,
              longitude: hasCoords ? Number(event.longitude) : null,
              distanceMeters: distance,
            },
            create: {
              organizationId, employeeId: userId, date: day,
              status: finalStatus, markedById: userId, checkInAt: recordedAt,
              latitude: hasCoords ? Number(event.latitude) : null,
              longitude: hasCoords ? Number(event.longitude) : null,
              distanceMeters: distance,
            },
          })

          await prisma.$executeRaw`
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
          if (!attendance) {
            throw new Error("Cannot check out offline before a check-in exists")
          }
          await prisma.$executeRaw`
            UPDATE "AttendanceRecord"
            SET "checkOutAt"=${recordedAt},
                "offlineRecorded"=TRUE,
                "localRecordedAt"=COALESCE("localRecordedAt", ${recordedAt}),
                "syncedAt"=CURRENT_TIMESTAMP,
                "clientEventId"=${clientEventId},
                "gpsAccuracy"=${event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null},
                "networkType"=${event.networkType || "offline"},
                "attendanceDeviceId"=${event.deviceId || null}
            WHERE id=${attendance.id}
          `
        }

        if (anomaly) {
          await prisma.$executeRaw`
            INSERT INTO "AttendanceAnomaly"
              ("id","organizationId","employeeId","attendanceId","siteId","type","severity","message","metadata")
            VALUES
              (${`an_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`},
               ${organizationId},${userId},${attendance.id},${siteId},${anomaly.type},${anomaly.severity},
               ${anomaly.message},${JSON.stringify({ distanceMeters: distance })}::jsonb)
          `
        }

        results.synced += 1
      } catch (eventError) {
        results.rejected.push({ clientEventId: event?.clientEventId || null, error: eventError.message })
      }
    }

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
    const { userId, organizationId } = req.user
    const { requestedCheckInAt, requestedCheckOutAt, reason, attendanceId } = req.body
    if (!String(reason || "").trim()) return res.status(400).json({ error: "A reason is required" })
    const correctionId = `cor_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`
    await prisma.$executeRaw`
      INSERT INTO "AttendanceCorrection"
        ("id","organizationId","employeeId","attendanceId","requestedCheckInAt","requestedCheckOutAt","reason")
      VALUES
        (${correctionId},${organizationId},${userId},${attendanceId || null},
         ${requestedCheckInAt ? new Date(requestedCheckInAt) : null},
         ${requestedCheckOutAt ? new Date(requestedCheckOutAt) : null},
         ${String(reason).trim()})
    `
    res.status(201).json({ id: correctionId, status: "PENDING" })
  } catch (err) {
    next(err)
  }
}

async function listAttendanceCorrections(req, res, next) {
  try {
    const rows = await prisma.$queryRaw`
      SELECT c.*, u.name AS "employeeName", r.date
      FROM "AttendanceCorrection" c
      JOIN "User" u ON u.id=c."employeeId"
      LEFT JOIN "AttendanceRecord" r ON r.id=c."attendanceId"
      WHERE c."organizationId"=${req.user.organizationId}
      ORDER BY c."createdAt" DESC
      LIMIT 100
    `
    res.json(rows)
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
}
