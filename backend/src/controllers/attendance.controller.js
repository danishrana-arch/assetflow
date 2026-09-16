const crypto = require("crypto")
const prisma = require("../lib/prisma")
const ExcelJS = require("exceljs")
const { toDateOnly } = require("../utils/date")
const { workingMinutesPerDay, expectedWeeklyMinutes, isScheduledWorkday } = require("../utils/work-schedule")
const { distanceMeters } = require("../utils/geo")
const { siteDistance } = require("../utils/site-geofence")
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

async function computeFinalAttendance(orgId, employeeId, date, record) {
  if (!record) return { status: "ABSENT", outsideMinutes: 0, lastPresence: null, reason: "No valid check-in" }
  if (record.status === "LEAVE") return { status: "LEAVE", outsideMinutes: 0, lastPresence: null, reason: "Approved leave" }

  const events = await prisma.$queryRaw`
    SELECT e."eventType", e."recordedAt", e.inside, e."siteId", s.name AS "siteName", e."distanceMeters", e.metadata
    FROM "AttendancePresenceEvent" e
    LEFT JOIN "AttendanceSite" s ON s.id=e."siteId"
    WHERE "organizationId"=${orgId} AND "employeeId"=${employeeId}
      AND "recordedAt" >= ${date} AND "recordedAt" < (${date} + INTERVAL '1 day')
    ORDER BY "recordedAt" ASC
  `
  let inside = true
  let outsideStart = null
  let outsideMinutes = 0
  let lastPresence = null
  for (const e of events) {
    const eventTime = new Date(e.recordedAt)
    if (e.inside) {
      if (outsideStart) outsideMinutes += Math.max(0, (eventTime - outsideStart) / 60000)
      outsideStart = null
      inside = true
    } else {
      if (!outsideStart) outsideStart = eventTime
      inside = false
    }
    lastPresence = { inside: !!e.inside, recordedAt: eventTime.toISOString(), siteId: e.siteId || null, siteName: e.siteName || null, distanceMeters: e.distanceMeters == null ? null : Number(e.distanceMeters) }
  }
  const end = record.checkOutAt ? new Date(record.checkOutAt) : new Date()
  if (!inside && outsideStart) outsideMinutes += Math.max(0, (end - outsideStart) / 60000)

  // Exclude only the portion of an outside interval that overlaps the configured break.
  if (org.breakStart && org.breakEnd) {
    const a=parseHHMM(org.breakStart), b=parseHHMM(org.breakEnd)
    if (a != null && b != null && a !== b) {
      let breakOverlap = 0
      const intervals=[]
      let currentOutside=null
      for (const e of events) {
        const t=new Date(e.recordedAt)
        if (!e.inside) { if (!currentOutside) currentOutside=t }
        else if (currentOutside) { intervals.push([currentOutside,t]); currentOutside=null }
      }
      if (currentOutside) intervals.push([currentOutside,end])
      for (const [startAt,endAt] of intervals) {
        const startMin=localMinutes(startAt,org.timezone||'UTC'), endMin=localMinutes(endAt,org.timezone||'UTC')
        // Attendance days are bounded to one local date, so a normal break is a single interval.
        if (b > a) {
          const overlapStart=Math.max(startMin,a), overlapEnd=Math.min(endMin,b)
          if (overlapEnd>overlapStart) breakOverlap += overlapEnd-overlapStart
        } else {
          if (startMin>=a) breakOverlap += Math.max(0,Math.min(endMin,1440)-startMin)
          if (endMin<=b) breakOverlap += Math.max(0,endMin-Math.max(startMin,0))
        }
      }
      outsideMinutes=Math.max(0,outsideMinutes-breakOverlap)
    }
  }

  const graceCandidates = await prisma.$queryRaw`
    SELECT COALESCE(MAX(s."outsideGraceMinutes"),60)::int AS "graceMinutes"
    FROM "AttendanceSite" s
    LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${employeeId}
    WHERE s."organizationId"=${orgId} AND s.active=TRUE
      AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${employeeId}))
  `
  const grace = Number(graceCandidates[0]?.graceMinutes || 60)
  const finalStatus = !record.checkInAt ? "ABSENT" : (!lastPresence || lastPresence.inside || outsideMinutes < grace ? "PRESENT" : "ABSENT")
  return {
    status: finalStatus,
    outsideMinutes: Math.round(outsideMinutes),
    lastPresence,
    reason: finalStatus === "ABSENT" ? `Outside authorized site for ${Math.round(outsideMinutes)} minutes without returning` : null,
  }
}

async function exportAttendanceSheet(req, res, next) {
  try {
    const { organizationId } = req.user
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workingHoursPerDay: true, workingDaysPerWeek: true, timezone: true, breakStart: true, breakEnd: true, shiftStartDefault: true, shiftEndDefault: true },
    })
    if (!organization) return res.status(404).json({ error: "Organization not found" })

    const tz = organization.timezone || "UTC"
    const requestedDate = req.query.date || dateKeyInTimeZone(new Date(), tz)
    const from = req.query.from || requestedDate
    const to = req.query.to || requestedDate
    const format = String(req.query.format || "xlsx").toLowerCase()
    const fromDate = toDateOnly(from)
    const toDate = toDateOnly(to)
    const endExclusive = new Date(toDate)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

    const [employees, records] = await Promise.all([
      prisma.user.findMany({ where: { organizationId, status: "ACTIVE" }, include: { department: true }, orderBy: { name: "asc" } }),
      prisma.attendanceRecord.findMany({ where: { organizationId, date: { gte: fromDate, lt: endExclusive } }, orderBy: [{ date: "asc" }, { employeeId: "asc" }] }),
    ])
    const byKey = new Map(records.map(r => [`${r.employeeId}|${r.date.toISOString().slice(0,10)}`, r]))
    const rows=[]
    for (let d=new Date(fromDate); d<endExclusive; d.setUTCDate(d.getUTCDate()+1)) {
      const dateOnly=new Date(d)
      const dayKey=dateOnly.toISOString().slice(0,10)
      for (const emp of employees) {
        const record=byKey.get(`${emp.id}|${dayKey}`)
        const final=await computeFinalAttendance(organizationId, emp.id, dateOnly, record)
        rows.push({
          employee: emp.name, department: emp.department?.name || "", date: dayKey,
          status: final.status, reason: final.reason || "", site: final.lastPresence?.siteName || final.lastPresence?.siteId || "",
          checkIn: record?.checkInAt ? record.checkInAt.toISOString() : "", checkOut: record?.checkOutAt ? record.checkOutAt.toISOString() : "",
          workingMinutes: record?.workingMinutes ?? "", outsideMinutes: final.outsideMinutes,
          source: record?.source || "MANUAL", offline: record?.offlineRecorded ? "YES" : "NO",
          latitude: record?.latitude == null ? "" : Number(record.latitude), longitude: record?.longitude == null ? "" : Number(record.longitude),
          gpsAccuracy: record?.gpsAccuracy ?? "", distanceMeters: record?.distanceMeters ?? "",
        })
      }
    }

    const presenceEvents = await prisma.$queryRaw`
      SELECT e."recordedAt", e."employeeId", u.name AS "employeeName", e."eventType", e.inside,
             e."siteId", s.name AS "siteName", p.name AS "projectName", e."latitude", e."longitude",
             e."gpsAccuracy", e."distanceMeters", e.metadata
      FROM "AttendancePresenceEvent" e
      JOIN "User" u ON u.id=e."employeeId"
      LEFT JOIN "AttendanceSite" s ON s.id=e."siteId"
      LEFT JOIN "Project" p ON p.id=s."projectId"
      WHERE e."organizationId"=${organizationId}
        AND e."recordedAt" >= ${fromDate} AND e."recordedAt" < ${endExclusive}
      ORDER BY e."recordedAt" ASC
    `

    if (format === "csv") {
      const headers=["Employee","Department","Date","Final Status","Reason","Site","Check In","Check Out","Working Minutes","Outside Site Minutes","Source","Offline","Latitude","Longitude","GPS Accuracy","Check-in Distance"]
      const esc=v=>`"${String(v ?? "").replace(/"/g,'""')}"`
      const csv=[headers, ...rows.map(r=>[r.employee,r.department,r.date,r.status,r.reason,r.site,r.checkIn,r.checkOut,r.workingMinutes,r.outsideMinutes,r.source,r.offline,r.latitude,r.longitude,r.gpsAccuracy,r.distanceMeters])].map(row=>row.map(esc).join(',')).join('\r\n')
      res.setHeader("Content-Type","text/csv; charset=utf-8")
      res.setHeader("Content-Disposition",`attachment; filename="Attendance_${from}_${to}.csv"`)
      return res.send("\ufeff"+csv)
    }

    const workbook=new ExcelJS.Workbook()
    workbook.creator="AssetFlow"
    const sheet=workbook.addWorksheet("Final Attendance Report")
    sheet.columns=[
      {header:"Employee",key:"employee",width:24},{header:"Department",key:"department",width:18},{header:"Date",key:"date",width:13},{header:"Final Status",key:"status",width:15},{header:"Reason",key:"reason",width:42},{header:"Site",key:"site",width:24},{header:"Check In",key:"checkIn",width:24},{header:"Check Out",key:"checkOut",width:24},{header:"Working Minutes",key:"workingMinutes",width:17},{header:"Outside Site Minutes",key:"outsideMinutes",width:21},{header:"Source",key:"source",width:13},{header:"Offline",key:"offline",width:10},{header:"Latitude",key:"latitude",width:14},{header:"Longitude",key:"longitude",width:14},{header:"GPS Accuracy",key:"gpsAccuracy",width:15},{header:"Check-in Distance",key:"distanceMeters",width:18},
    ]
    rows.forEach(r=>sheet.addRow(r))
    sheet.getRow(1).font={bold:true}
    sheet.views=[{state:"frozen",ySplit:1}]
    sheet.autoFilter={from:"A1",to:`P${Math.max(1,rows.length+1)}`}

    const timeline = workbook.addWorksheet("Presence Timeline")
    timeline.columns=[
      {header:"Time",key:"time",width:24},{header:"Employee",key:"employee",width:24},{header:"Event",key:"event",width:22},
      {header:"Inside Site",key:"inside",width:14},{header:"Site",key:"site",width:24},{header:"Project",key:"project",width:24},
      {header:"Latitude",key:"lat",width:14},{header:"Longitude",key:"lng",width:14},{header:"GPS Accuracy",key:"accuracy",width:15},
      {header:"Distance",key:"distance",width:14},{header:"Source",key:"source",width:14},
    ]
    presenceEvents.forEach((e) => timeline.addRow({
      time: new Date(e.recordedAt).toISOString(), employee: e.employeeName || e.employeeId, event: e.eventType,
      inside: e.inside == null ? "" : (e.inside ? "YES" : "NO"), site: e.siteName || e.siteId || "", project: e.projectName || "",
      lat: e.latitude == null ? "" : Number(e.latitude), lng: e.longitude == null ? "" : Number(e.longitude),
      accuracy: e.gpsAccuracy == null ? "" : Number(e.gpsAccuracy), distance: e.distanceMeters == null ? "" : Number(e.distanceMeters),
      source: e.metadata?.source || "LIVE",
    }))
    timeline.getRow(1).font={bold:true}
    timeline.views=[{state:"frozen",ySplit:1}]
    timeline.autoFilter={from:"A1",to:`K${Math.max(1,presenceEvents.length+1)}`}

    const sitesSheet = workbook.addWorksheet("Site Summary")
    sitesSheet.columns=[{header:"Site",key:"site",width:28},{header:"Project",key:"project",width:28},{header:"Events",key:"events",width:12},{header:"Inside Events",key:"inside",width:16},{header:"Outside Events",key:"outside",width:17}]
    const siteMap = new Map()
    for (const e of presenceEvents) {
      const key=e.siteName || e.siteId || "Unassigned"
      const row=siteMap.get(key) || {site:key,project:e.projectName || "",events:0,inside:0,outside:0}
      row.events += 1
      if (e.inside) row.inside += 1
      else if (e.inside === false) row.outside += 1
      siteMap.set(key,row)
    }
    for (const row of siteMap.values()) sitesSheet.addRow(row)
    sitesSheet.getRow(1).font={bold:true}
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    res.setHeader("Content-Disposition",`attachment; filename="Attendance_${from}_${to}.xlsx"`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) { next(err) }
}

async function markSelfAttendance(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { status, latitude, longitude, siteId } = req.body || {}
    if (!['PRESENT','ABSENT'].includes(status)) return res.status(400).json({ error: 'status must be one of: PRESENT, ABSENT' })

    const [organization, employee] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { geofenceEnabled:true, officeLatitude:true, officeLongitude:true, geofenceRadiusMeters:true, shiftStartDefault:true, lateThresholdMinutes:true, timezone:true, breakStart:true, breakEnd:true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { workLocationType:true, shiftStart:true } }),
    ])
    if (!organization || !employee) return res.status(404).json({ error: 'Employee or organization not found' })
    const today=startOfDay(null, organization.timezone)
    const existing=await prisma.attendanceRecord.findUnique({ where:{ employeeId_date:{employeeId:userId,date:today} } })
    if (existing?.status==='LEAVE') return res.status(400).json({ error:'Today is already recorded as leave' })

    const hasCoords=Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    const isMobileDevice=/Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(String(req.headers['user-agent']||''))
    if (status==='PRESENT' && isMobileDevice && !hasCoords) return res.status(400).json({ error:'Location is required to mark attendance from a mobile or tablet' })

    let chosenSite=null, chosenDistance=null, assignedSites=[]
    if (hasCoords) {
      assignedSites=await prisma.$queryRaw`
        SELECT DISTINCT s.* FROM "AttendanceSite" s
        LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${userId}
        WHERE s."organizationId"=${organizationId} AND s.active=TRUE
          AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${userId}))
      `
      for (const site of assignedSites) {
        const result = siteDistance(site, Number(latitude), Number(longitude))
        if (!chosenSite || (result.inside && !siteDistance(chosenSite, Number(latitude), Number(longitude)).inside) || (!result.inside && chosenDistance != null && result.distance < chosenDistance)) { chosenSite=site; chosenDistance=result.distance }
      }
      if (siteId) {
        const requested=assignedSites.find(s=>s.id===String(siteId))
        if (!requested) return res.status(403).json({ error:'The selected site is not assigned to you' })
        chosenSite=requested
        chosenDistance=siteDistance(requested, Number(latitude), Number(longitude)).distance
      }
    }

    const officeGeofenceActive=organization.geofenceEnabled && organization.officeLatitude!=null && organization.officeLongitude!=null && employee.workLocationType!=='FIELD'
    const assignedSiteMode=assignedSites.length>0 && employee.workLocationType!=='FIELD'
    let finalStatus=status, autoFlagged=false
    if (status==='PRESENT' && hasCoords && assignedSiteMode) {
      const eligible=assignedSites.some(site => site.geofenceMode === 'DISABLED' || siteDistance(site, Number(latitude), Number(longitude)).inside)
      const strictRequired=assignedSites.some(site => site.geofenceMode === 'STRICT')
      if (!eligible && strictRequired) {
        finalStatus='ABSENT'; autoFlagged=true
      }
    } else if (status==='PRESENT' && officeGeofenceActive && hasCoords) {
      const distance=distanceMeters(Number(latitude),Number(longitude),Number(organization.officeLatitude),Number(organization.officeLongitude))
      chosenDistance=distance
      if (distance > Number(organization.geofenceRadiusMeters)) { finalStatus='ABSENT'; autoFlagged=true }
    }

    const now=new Date()
    const shiftStartStr=(employee.shiftStart && employee.shiftStart.trim()) || organization.shiftStartDefault || '09:00'
    if (status==='PRESENT' && !autoFlagged && localMinutes(now,organization.timezone||'UTC') > parseHHMM(shiftStartStr)+Number(organization.lateThresholdMinutes||15)) finalStatus='LATE'
    const locationData=hasCoords ? {latitude:Number(latitude),longitude:Number(longitude),distanceMeters:chosenDistance==null?null:Math.round(chosenDistance)} : {latitude:null,longitude:null,distanceMeters:null}

    const record=await prisma.attendanceRecord.upsert({
      where:{employeeId_date:{employeeId:userId,date:today}},
      update:{status:finalStatus,markedById:userId,autoFlagged,checkInAt:now,...locationData},
      create:{organizationId,employeeId:userId,date:today,status:finalStatus,markedById:userId,autoFlagged,checkInAt:now,...locationData},
    })
    if (hasCoords) {
      const presenceId=`ape_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`
      await prisma.$executeRaw`
        INSERT INTO "AttendancePresenceEvent"
          ("id","organizationId","employeeId","attendanceId","siteId","eventType","recordedAt","latitude","longitude","gpsAccuracy","distanceMeters","inside","clientEventId","metadata")
        VALUES
          (${presenceId},${organizationId},${userId},${record.id},${chosenSite?.id||null},${chosenSite && siteDistance(chosenSite, Number(latitude), Number(longitude)).inside ? 'GEOFENCE_ENTER':'GEOFENCE_EXIT'},${now},${Number(latitude)},${Number(longitude)},${req.body?.gpsAccuracy!=null?Number(req.body.gpsAccuracy):null},${chosenDistance},${chosenSite ? siteDistance(chosenSite, Number(latitude), Number(longitude)).inside : null},${req.body?.clientEventId||null},${JSON.stringify({source:'CHECK_IN',siteName:chosenSite?.name||null})}::jsonb)
        ON CONFLICT ("clientEventId") DO NOTHING
      `
    }
    res.json({ ...record, requestedStatus:status, autoFlagged, site:chosenSite ? {id:chosenSite.id,name:chosenSite.name,distanceMeters:Math.round(chosenDistance),radiusMeters:Number(chosenSite.radiusMeters)} : null })
  } catch(err) { next(err) }
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
      const clientEventId = String(event?.clientEventId || "").trim()
      try {
        const status = event?.type === "CHECK_OUT" ? "CHECK_OUT" : event?.type === "CHECK_IN" ? "CHECK_IN" : event?.type === "GEOFENCE" ? "GEOFENCE" : null
        if (!clientEventId || !status || !event.localRecordedAt || !event.localDate) {
          throw new Error("Invalid offline attendance event")
        }

        const recordedAt = new Date(event.localRecordedAt)
        if (Number.isNaN(recordedAt.getTime())) throw new Error("Invalid recorded timestamp")
        const day = toDateOnly(String(event.localDate))
        const hasCoords = Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude))

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
          await prisma.$transaction(async (tx) => {
            let siteId = event.siteId ? String(event.siteId) : null
            let distance = null
            let anomaly = null

            if (hasCoords) {
              const assigned = await tx.$queryRaw`
                SELECT DISTINCT s.* FROM "AttendanceSite" s
                LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${userId}
                WHERE s."organizationId"=${organizationId} AND s.active=TRUE
                  AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${userId}))
              `
              let best=null
              for (const site of assigned) {
                const result=siteDistance(site, Number(event.latitude), Number(event.longitude))
                if (!best || (result.inside && !best.inside) || (result.inside === best.inside && result.distance < best.distance)) best={site,distance:result.distance,inside:result.inside}
              }
              if (siteId && !assigned.some(s=>s.id===siteId)) throw new Error("Attendance site is not assigned to this employee")
              if (best) {
                siteId=best.site.id
                distance=best.distance
                const inside=best.inside
                if ((status === "CHECK_IN" || status === "CHECK_OUT") && best.site.geofenceMode === "STRICT" && !inside) {
                  throw new Error(`Outside all assigned site geofences (${Math.round(distance)}m from nearest site)`)
                }
                if (!inside) anomaly={type:"OUTSIDE_SITE",severity:"HIGH",message:`Attendance location is ${Math.round(distance)}m from nearest assigned site (${best.site.name})`}
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
                ON CONFLICT ("clientEventId") DO NOTHING
              `
            } else if (status === "CHECK_IN") {
              let finalStatus = "PRESENT"
              const shiftStartStr = event.shiftStart || org?.shiftStartDefault || "09:00"
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

              attendance = await tx.attendanceRecord.upsert({
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
                  organizationId,
                  employeeId: userId,
                  date: day,
                  status: finalStatus,
                  markedById: userId,
                  checkInAt: recordedAt,
                  latitude: hasCoords ? Number(event.latitude) : null,
                  longitude: hasCoords ? Number(event.longitude) : null,
                  distanceMeters: distance,
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
              if (!attendance) throw new Error("Cannot check out offline before a check-in exists")

              await tx.$executeRaw`
                UPDATE "AttendanceRecord"
                SET "checkOutAt"=${recordedAt},
                    "offlineRecorded"=TRUE,
                    "localRecordedAt"=COALESCE("localRecordedAt", ${recordedAt}),
                    "syncedAt"=CURRENT_TIMESTAMP,
                    "gpsAccuracy"=${event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null},
                    "networkType"=${event.networkType || "offline"},
                    "attendanceDeviceId"=${event.deviceId || null}
                WHERE id=${attendance.id}
              `
            }

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
  computeFinalAttendance,
}
