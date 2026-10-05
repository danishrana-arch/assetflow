const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")
const { dateKeyInTimeZone } = require("../utils/timezone")
const { siteDistance } = require("../utils/site-geofence")
const { formatTime12 } = require("../utils/attendance-rules")
const { logAudit } = require("../utils/audit")
const { createNotification, notifyManagement } = require("../utils/notifications")
const { applyAttendanceEvaluation, refreshPayslipForDay } = require("../services/attendance-engine")

// Site Admin / Project Manager attendance workspace (role SITE_ADMIN).
// A Site Admin marks attendance for workers who can't use the app
// themselves, but only:
//   - at sites assigned to them (AttendanceSiteAdmin), active, whose project
//     isn't completed, in their own (home) organization;
//   - for ACTIVE employees bound to that site — assigned directly
//     (AttendanceSiteEmployee) or members of the site's project.
// The site's geofence still applies to the Site Admin's own device:
// STRICT blocks the action outside the site, WARNING records it and flags
// it, DISABLED skips the check. Online and offline actions go through the
// same idempotent journal (AttendanceSyncEvent, keyed by clientEventId), and
// every action is written to AttendancePresenceEvent (actorId = the Site
// Admin) + the audit log, so the per-site history survives moving between
// sites, unassignment or site deletion.

const ACTIONS = ["CHECK_IN", "CHECK_OUT", "MARK_ABSENT"]
const OFFLINE_MAX_AGE_DAYS = 7
const CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_NOTE = 500
const HISTORY_MAX_DAYS = 92

// A rejection the client should stop retrying (business rule, not a network
// or server failure). `permanent` lets the offline queue drop it.
class ActionError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
    this.permanent = true
  }
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`
}

async function loadActor(userId) {
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true, status: true, organizationId: true, organization: { select: { timezone: true } } },
  })
  if (!actor || actor.role !== "SITE_ADMIN" || actor.status !== "ACTIVE") return null
  return { ...actor, timezone: actor.organization?.timezone || "UTC" }
}

function usable(site) {
  return site.active && !(site.Project && site.Project.status === "COMPLETED")
}

async function assignedSitesOf(db, actor) {
  const rows = await db.attendanceSiteAdmin.findMany({
    where: { userId: actor.id, organizationId: actor.organizationId },
    include: { site: { include: { Project: { select: { id: true, name: true, status: true } } } } },
  })
  return rows.map((r) => r.site).filter((s) => s.organizationId === actor.organizationId)
}

// The site, if it's assigned to this Site Admin and can take attendance.
async function authorizedSite(db, actor, siteId) {
  if (!siteId) throw new ActionError("Choose a site first")
  const row = await db.attendanceSiteAdmin.findUnique({
    where: { siteId_userId: { siteId: String(siteId), userId: actor.id } },
    include: { site: { include: { Project: { select: { id: true, name: true, status: true } } } } },
  })
  const site = row?.site
  if (!site || site.organizationId !== actor.organizationId) throw new ActionError("This site is not assigned to you", 403)
  if (!site.active) throw new ActionError(`${site.name} is inactive — attendance can't be marked there`, 403)
  if (site.Project?.status === "COMPLETED") throw new ActionError(`${site.Project.name} is completed — ${site.name} no longer takes attendance`, 403)
  return site
}

// Active employees bound to a site: assigned directly or via its project.
async function siteRoster(db, site, excludeUserId) {
  const [direct, members] = await Promise.all([
    db.attendanceSiteEmployee.findMany({ where: { siteId: site.id }, select: { employeeId: true } }),
    site.projectId ? db.projectMember.findMany({ where: { projectId: site.projectId }, select: { employeeId: true } }) : [],
  ])
  const viaProject = new Set(members.map((m) => m.employeeId))
  const ids = [...new Set([...direct.map((d) => d.employeeId), ...viaProject])].filter((id) => id !== excludeUserId)
  if (!ids.length) return []
  const employees = await db.user.findMany({
    where: { id: { in: ids }, organizationId: site.organizationId, status: "ACTIVE" },
    select: { id: true, name: true, photoUrl: true, designation: true, department: { select: { name: true } } },
    orderBy: { name: "asc" },
  })
  return employees.map((e) => ({ ...e, viaProject: viaProject.has(e.id) }))
}

async function assertOnRoster(db, site, employeeId, actorId) {
  if (!employeeId) throw new ActionError("Choose an employee")
  if (employeeId === actorId) throw new ActionError("Use My Attendance for your own check-in")
  const roster = await siteRoster(db, site, actorId)
  const employee = roster.find((e) => e.id === employeeId)
  if (!employee) throw new ActionError("This employee isn't assigned to this site or its project", 403)
  return employee
}

// Where the Site Admin's device is relative to the site.
function geofenceCheck(site, latitude, longitude) {
  const hasCoords = Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && latitude !== null && longitude !== null && latitude !== "" && longitude !== ""
  if (site.geofenceMode === "DISABLED") {
    return { hasCoords, inside: null, distance: hasCoords ? Math.round(siteDistance(site, Number(latitude), Number(longitude)).distance) : null, flagged: false }
  }
  if (!hasCoords) {
    if (site.geofenceMode === "STRICT") throw new ActionError(`${site.name} requires your location — allow location access and try again`, 403)
    return { hasCoords, inside: null, distance: null, flagged: true }
  }
  const result = siteDistance(site, Number(latitude), Number(longitude))
  const distance = Math.round(result.distance)
  if (!result.inside && site.geofenceMode === "STRICT") {
    throw new ActionError(`You are ${distance}m from ${site.name} — attendance can only be marked inside the site`, 403)
  }
  return { hasCoords, inside: result.inside, distance, flagged: !result.inside }
}

const STATUS_WORD = { PRESENT: "Present", LATE: "Late", ABSENT: "Absent", LEAVE: "Leave" }

function rowState(record) {
  if (!record) return "NOT_CHECKED_IN"
  if (record.status === "LEAVE") return "LEAVE"
  if (record.status === "ABSENT") return record.checkInAt ? "CHECKED_OUT" : "ABSENT"
  if (record.checkInAt && record.checkOutAt) return "CHECKED_OUT"
  if (record.checkInAt) return "CHECKED_IN"
  return "MARKED"
}

// Processes one Site Admin action (online or replayed from the offline
// queue). The server is authoritative: it re-checks assignment, roster,
// geofence, time and the day's current state. Throws ActionError on a
// business-rule rejection.
async function processAction(actor, event, { offline, userAgent }) {
  const action = String(event?.action || "")
  if (!ACTIONS.includes(action)) throw new ActionError(`action must be one of: ${ACTIONS.join(", ")}`)

  const now = new Date()
  let at = now
  if (offline) {
    at = new Date(event.localRecordedAt)
    if (Number.isNaN(at.getTime())) throw new ActionError("Invalid recorded time")
    if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) throw new ActionError("This action's time is in the future — check the device clock")
    if (now.getTime() - at.getTime() > OFFLINE_MAX_AGE_DAYS * 86400000) {
      throw new ActionError(`Offline actions older than ${OFFLINE_MAX_AGE_DAYS} days can't be synced — send a correction request instead`)
    }
  }
  const note = String(event.note || "").trim().slice(0, MAX_NOTE) || null

  const site = await authorizedSite(prisma, actor, event.siteId)
  const employee = await assertOnRoster(prisma, site, String(event.employeeId || ""), actor.id)
  const geo = geofenceCheck(site, event.latitude, event.longitude)
  // Days are keyed in the organization's timezone (same as every other
  // attendance path); the site's timezone drives the late/half-day math.
  const day = toDateOnly(dateKeyInTimeZone(at, actor.timezone))
  const dayKey = day.toISOString().slice(0, 10)
  const timeLabel = formatTime12(at, site.timezone || actor.timezone)

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: day } } })
    if (existing?.status === "LEAVE") throw new ActionError(`${employee.name} is on approved leave on ${dayKey}`)

    const location = geo.hasCoords
      ? { latitude: Number(event.latitude), longitude: Number(event.longitude), distanceMeters: geo.distance, gpsAccuracy: event.gpsAccuracy != null ? Number(event.gpsAccuracy) : null }
      : {}
    const offlineData = offline
      ? { offlineRecorded: true, localRecordedAt: at, syncedAt: now, attendanceDeviceId: event.deviceId ? String(event.deviceId).slice(0, 120) : null, networkType: "offline" }
      : {}

    let record
    if (action === "CHECK_IN") {
      if (existing?.checkInAt && existing.status !== "ABSENT") {
        throw new ActionError(`${employee.name} is already checked in (${formatTime12(existing.checkInAt, site.timezone || actor.timezone)})`, 409)
      }
      const data = {
        status: "PRESENT", checkInAt: at, checkOutAt: null, autoCheckedOut: false, markedById: actor.id, source: "MANUAL",
        siteId: site.id, checkOutSiteId: null, locationMode: "OFFICE", autoFlagged: geo.flagged, clientEventId: event.clientEventId || null,
        ...location, ...offlineData,
      }
      const saved = await tx.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: day } },
        update: data,
        create: { organizationId: actor.organizationId, employeeId: employee.id, date: day, ...data },
      })
      // Present/Late from the check-in time, in the site's timezone — a
      // flagged location is reviewed by HR but doesn't make the worker late.
      record = await applyAttendanceEvaluation(tx, saved.id, { recomputeStatus: true })
    } else if (action === "CHECK_OUT") {
      if (!existing?.checkInAt || existing.status === "ABSENT") throw new ActionError(`${employee.name} hasn't checked in on ${dayKey}`)
      if (existing.checkOutAt) {
        throw new ActionError(`${employee.name} is already checked out (${formatTime12(existing.checkOutAt, site.timezone || actor.timezone)})`, 409)
      }
      if (at <= existing.checkInAt) throw new ActionError("Check-out must be after the check-in time")
      const saved = await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          checkOutAt: at, autoCheckedOut: false, markedById: actor.id,
          checkOutSiteId: existing.siteId && existing.siteId !== site.id ? site.id : null,
          ...(geo.flagged ? { autoFlagged: true } : {}),
          ...(offline ? { syncedAt: now } : {}),
        },
      })
      record = await applyAttendanceEvaluation(tx, saved.id)
    } else {
      if (existing?.checkInAt && existing.status !== "ABSENT") {
        throw new ActionError(`${employee.name} checked in today — send a correction request to change it`, 409)
      }
      if (existing && ["PRESENT", "LATE"].includes(existing.status)) {
        throw new ActionError(`${employee.name} is already marked present for ${dayKey} — send a correction request to change it`, 409)
      }
      if (existing?.status === "ABSENT") throw new ActionError(`${employee.name} is already marked absent on ${dayKey}`, 409)
      const saved = await tx.attendanceRecord.upsert({
        where: { employeeId_date: { employeeId: employee.id, date: day } },
        update: { status: "ABSENT", markedById: actor.id, siteId: site.id, ...offlineData },
        create: { organizationId: actor.organizationId, employeeId: employee.id, date: day, status: "ABSENT", markedById: actor.id, siteId: site.id, ...offlineData },
      })
      record = await applyAttendanceEvaluation(tx, saved.id)
    }

    const metadata = {
      action,
      source: offline ? "OFFLINE" : "ONLINE",
      device: String(userAgent || "").slice(0, 200) || null,
      deviceId: event.deviceId ? String(event.deviceId).slice(0, 120) : null,
      previousStatus: existing?.status || null,
      newStatus: record.status,
      previousCheckInAt: existing?.checkInAt || null,
      previousCheckOutAt: existing?.checkOutAt || null,
      checkInAt: record.checkInAt,
      checkOutAt: record.checkOutAt,
      dayType: record.dayType,
      note,
      siteName: site.name,
      projectName: site.Project?.name || null,
      employeeName: employee.name,
      actorName: actor.name,
      actorRole: "SITE_ADMIN",
      outsideSite: geo.flagged,
      date: dayKey,
    }
    await tx.$executeRaw`
      INSERT INTO "AttendancePresenceEvent"
        ("id","organizationId","employeeId","attendanceId","siteId","eventType","recordedAt","latitude","longitude","gpsAccuracy","distanceMeters","inside","clientEventId","metadata","actorId","projectId")
      VALUES
        (${newId("ape")},${actor.organizationId},${employee.id},${record.id},${site.id},${`SITE_ADMIN_${action}`},${at},
         ${geo.hasCoords ? Number(event.latitude) : null},${geo.hasCoords ? Number(event.longitude) : null},
         ${event.gpsAccuracy != null && geo.hasCoords ? Number(event.gpsAccuracy) : null},${geo.distance},${geo.inside},
         ${event.clientEventId || null},${JSON.stringify(metadata)}::jsonb,${actor.id},${site.projectId || null})
      ON CONFLICT ("clientEventId") WHERE "clientEventId" IS NOT NULL DO NOTHING
    `
    if (geo.flagged) {
      await tx.$executeRaw`
        INSERT INTO "AttendanceAnomaly"
          ("id","organizationId","employeeId","attendanceId","siteId","type","severity","message","metadata")
        VALUES
          (${newId("an")},${actor.organizationId},${employee.id},${record.id},${site.id},'OUTSIDE_SITE','MEDIUM',
           ${geo.distance == null
             ? `${actor.name} (Site Admin) marked ${action.replace("_", " ").toLowerCase()} for ${site.name} without a location`
             : `${actor.name} (Site Admin) marked ${action.replace("_", " ").toLowerCase()} ${geo.distance}m outside ${site.name}`},
           ${JSON.stringify({ distanceMeters: geo.distance, actorId: actor.id, siteAdmin: true })}::jsonb)
      `
    }
    return { record, employee, site, day, dayKey, timeLabel, note, existing }
  }, { timeout: 20000, maxWait: 10000 }) // a few engine reads run inside; Neon round-trips are slow
}

function afterAction(actor, action, result) {
  const { record, employee, site, day, timeLabel, note, existing } = result
  const verb = { CHECK_IN: "checked in", CHECK_OUT: "checked out", MARK_ABSENT: "marked absent" }[action]
  logAudit({
    organizationId: actor.organizationId,
    actorId: actor.id,
    action: `attendance.site_admin_${action.toLowerCase()}`,
    targetType: "User",
    targetId: employee.id,
    note: `${employee.name} ${verb} at ${timeLabel} on ${result.dayKey} — ${site.name}${site.Project?.name ? ` (${site.Project.name})` : ""} by ${actor.name} (Site Admin); ${existing?.status || "no record"} → ${record.status}${note ? ` — ${note}` : ""}`,
  })
  if (action === "MARK_ABSENT") {
    createNotification({
      organizationId: actor.organizationId, recipientId: employee.id, createdById: actor.id, type: "ATTENDANCE",
      title: "Marked absent", message: `${actor.name} marked you absent at ${site.name} on ${result.dayKey}.`, link: "/attendance/me",
    }).catch(() => {})
  }
  refreshPayslipForDay(actor.organizationId, employee.id, day)
}

function publicRecord(record, tz) {
  return {
    id: record.id,
    status: record.status,
    statusLabel: STATUS_WORD[record.status] || record.status,
    state: rowState(record),
    checkInAt: record.checkInAt,
    checkOutAt: record.checkOutAt,
    checkInLabel: record.checkInAt ? formatTime12(record.checkInAt, tz) : null,
    checkOutLabel: record.checkOutAt ? formatTime12(record.checkOutAt, tz) : null,
    dayType: record.dayType,
    dayTypeReason: record.dayTypeReason,
    lateMinutes: record.lateMinutes,
    autoFlagged: record.autoFlagged,
  }
}

// Runs one event through the idempotency journal (same table and rules as
// the employee offline sync). Returns { status: "synced"|"duplicate", ... }.
async function journaled(actor, event, opts) {
  const clientEventId = String(event?.clientEventId || "").trim() || newId("sa")
  const action = String(event?.action || "")
  const recordedAt = opts.offline ? new Date(event.localRecordedAt) : new Date()
  const employeeId = String(event?.employeeId || "")
  if (!employeeId) throw new ActionError("Choose an employee")
  if (Number.isNaN(recordedAt.getTime())) throw new ActionError("Invalid recorded time")
  const localDate = toDateOnly(dateKeyInTimeZone(recordedAt, actor.timezone))

  const employeeExists = await prisma.user.findFirst({ where: { id: employeeId, organizationId: actor.organizationId }, select: { id: true } })
  if (!employeeExists) throw new ActionError("Employee not found", 404)

  const inserted = await prisma.$queryRaw`
    INSERT INTO "AttendanceSyncEvent" ("id","clientEventId","organizationId","employeeId","eventType","recordedAt","localDate","payload","status")
    VALUES (${newId("ase")},${clientEventId},${actor.organizationId},${employeeId},${`SITE_ADMIN_${action}`},${recordedAt},${localDate},
            ${JSON.stringify({ ...event, actorId: actor.id })}::jsonb,'PROCESSING')
    ON CONFLICT ("clientEventId") DO NOTHING
    RETURNING "id"
  `
  if (!inserted.length) {
    const [row] = await prisma.$queryRaw`SELECT "status", payload FROM "AttendanceSyncEvent" WHERE "clientEventId"=${clientEventId} LIMIT 1`
    if (row?.payload?.actorId && row.payload.actorId !== actor.id) throw new ActionError("Duplicate event id", 409)
    if (row?.status === "PROCESSED") return { status: "duplicate", clientEventId }
    const reclaimed = await prisma.$queryRaw`
      UPDATE "AttendanceSyncEvent" SET "status"='PROCESSING', "updatedAt"=CURRENT_TIMESTAMP, "lastError"=NULL
      WHERE "clientEventId"=${clientEventId}
        AND ("status" IN ('PENDING','FAILED') OR ("status"='PROCESSING' AND "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
      RETURNING "id"
    `
    if (!reclaimed.length) return { status: "duplicate", clientEventId }
  }

  try {
    const result = await processAction(actor, { ...event, clientEventId }, opts)
    await prisma.$executeRaw`
      UPDATE "AttendanceSyncEvent" SET "status"='PROCESSED', "processedAt"=CURRENT_TIMESTAMP, "updatedAt"=CURRENT_TIMESTAMP, "lastError"=NULL
      WHERE "clientEventId"=${clientEventId}
    `
    afterAction(actor, action, result)
    return { status: "synced", clientEventId, result }
  } catch (err) {
    await prisma.$executeRaw`
      UPDATE "AttendanceSyncEvent" SET "status"='FAILED', "lastError"=${String(err.message || "Failed").slice(0, 1000)}, "updatedAt"=CURRENT_TIMESTAMP
      WHERE "clientEventId"=${clientEventId}
    `
    throw err
  }
}

function sendError(res, next, err) {
  if (err instanceof ActionError) return res.status(err.status).json({ error: err.message, permanent: true })
  return next(err)
}

// GET /api/site-admin/sites — the Site Admin's assigned sites.
async function listMySites(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const sites = await assignedSitesOf(prisma, actor)
    const counts = await Promise.all(sites.map((s) => siteRoster(prisma, s, actor.id).then((r) => r.length)))
    res.json({
      timezone: actor.timezone,
      today: dateKeyInTimeZone(new Date(), actor.timezone),
      sites: sites
        .map((s, i) => ({
          id: s.id,
          name: s.name,
          address: s.address,
          timezone: s.timezone || actor.timezone,
          geofenceMode: s.geofenceMode,
          geofenceType: s.geofenceType,
          latitude: Number(s.latitude),
          longitude: Number(s.longitude),
          radiusMeters: s.radiusMeters,
          boundary: s.boundary,
          projectId: s.projectId,
          projectName: s.Project?.name || null,
          projectStatus: s.Project?.status || null,
          usable: usable(s),
          employeeCount: counts[i],
        }))
        .sort((a, b) => Number(b.usable) - Number(a.usable) || a.name.localeCompare(b.name)),
    })
  } catch (err) {
    next(err)
  }
}

// GET /api/site-admin/sites/:siteId/roster?date=YYYY-MM-DD
async function getSiteRoster(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const site = await authorizedSite(prisma, actor, req.params.siteId)
    const todayKey = dateKeyInTimeZone(new Date(), actor.timezone)
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : todayKey
    const day = toDateOnly(dateKey)
    const employees = await siteRoster(prisma, site, actor.id)
    const ids = employees.map((e) => e.id)
    const [records, pendingCorrections] = await Promise.all([
      ids.length ? prisma.attendanceRecord.findMany({ where: { employeeId: { in: ids }, date: day }, include: { markedBy: { select: { name: true, role: true } } } }) : [],
      ids.length
        ? prisma.$queryRaw`
            SELECT c."employeeId" FROM "AttendanceCorrection" c LEFT JOIN "AttendanceRecord" r ON r.id=c."attendanceId"
            WHERE c."employeeId" = ANY(${ids}) AND c.status='PENDING' AND (r.date=${day} OR (r.id IS NULL AND c."requestedCheckInAt"::date=${day}))
          `
        : [],
    ])
    const siteIds = [...new Set(records.flatMap((r) => [r.siteId, r.checkOutSiteId]).filter(Boolean))]
    const sites = siteIds.length ? await prisma.attendanceSite.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } }) : []
    const siteName = new Map(sites.map((s) => [s.id, s.name]))
    const byEmployee = new Map(records.map((r) => [r.employeeId, r]))
    const pending = new Set(pendingCorrections.map((c) => c.employeeId))
    const tz = site.timezone || actor.timezone
    res.json({
      site: { id: site.id, name: site.name, projectName: site.Project?.name || null, timezone: tz, geofenceMode: site.geofenceMode },
      date: dateKey,
      isToday: dateKey === todayKey,
      employees: employees.map((e) => {
        const r = byEmployee.get(e.id)
        return {
          id: e.id,
          name: e.name,
          photoUrl: e.photoUrl,
          designation: e.designation,
          department: e.department?.name || null,
          projectName: e.viaProject ? site.Project?.name || null : null,
          record: r ? publicRecord(r, tz) : null,
          state: rowState(r),
          markedByName: r?.markedBy?.name || null,
          markedBySiteAdmin: r?.markedBy?.role === "SITE_ADMIN",
          checkInSiteName: r?.siteId ? siteName.get(r.siteId) || null : null,
          checkOutSiteName: r?.checkOutSiteId ? siteName.get(r.checkOutSiteId) || null : null,
          atOtherSite: !!(r?.siteId && r.siteId !== site.id),
          pendingCorrection: pending.has(e.id),
        }
      }),
    })
  } catch (err) {
    sendError(res, next, err)
  }
}

// POST /api/site-admin/attendance  { clientEventId, siteId, employeeId, action, latitude?, longitude?, gpsAccuracy?, note? }
// Online action, at the server's time.
async function markSiteAttendance(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const out = await journaled(actor, req.body || {}, { offline: false, userAgent: req.headers["user-agent"] })
    if (out.status === "duplicate") return res.json({ duplicate: true, clientEventId: out.clientEventId })
    const tz = out.result.site.timezone || actor.timezone
    res.status(201).json({ clientEventId: out.clientEventId, record: publicRecord(out.result.record, tz), employeeId: out.result.employee.id })
  } catch (err) {
    sendError(res, next, err)
  }
}

// POST /api/site-admin/sync  { events: [{ clientEventId, localRecordedAt, siteId, employeeId, action, ... }] }
// Replays the device's offline queue in recorded order. Each event is
// idempotent by clientEventId; rejected ones come back with permanent=true
// when retrying can't help (the queue drops those).
async function syncSiteAttendance(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const events = (Array.isArray(req.body?.events) ? req.body.events.slice(0, 200) : [])
      .slice()
      .sort((a, b) => new Date(a?.localRecordedAt) - new Date(b?.localRecordedAt))
    const results = { synced: 0, duplicates: 0, rejected: [] }
    for (const event of events) {
      try {
        const out = await journaled(actor, event, { offline: true, userAgent: req.headers["user-agent"] })
        if (out.status === "duplicate") results.duplicates += 1
        else results.synced += 1
      } catch (err) {
        results.rejected.push({
          clientEventId: event?.clientEventId || null,
          error: err.message || "Sync failed",
          permanent: err instanceof ActionError,
        })
      }
    }
    res.json(results)
  } catch (err) {
    next(err)
  }
}

// POST /api/site-admin/corrections  { siteId, employeeId, date, requestedCheckInAt?, requestedCheckOutAt?, reason }
// A Site Admin can't rewrite attendance directly; they send the existing
// correction request on the worker's behalf, and HR/Admin approve it on the
// Attendance page (same reviewers and rules as an employee's own request).
async function requestSiteCorrection(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const { siteId, employeeId, date } = req.body || {}
    const reason = String(req.body?.reason || "").trim()
    if (!reason) throw new ActionError("A reason is required")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new ActionError("date (YYYY-MM-DD) is required")
    const checkIn = req.body.requestedCheckInAt ? new Date(req.body.requestedCheckInAt) : null
    const checkOut = req.body.requestedCheckOutAt ? new Date(req.body.requestedCheckOutAt) : null
    if ((checkIn && Number.isNaN(checkIn.getTime())) || (checkOut && Number.isNaN(checkOut.getTime()))) throw new ActionError("Requested times are not valid")
    if (!checkIn && !checkOut) throw new ActionError("Give the correct check-in and/or check-out time")
    if (checkIn && checkOut && checkOut <= checkIn) throw new ActionError("Check-out must be after check-in")
    const latest = new Date(Date.now() + CLOCK_SKEW_MS)
    if ((checkIn && checkIn > latest) || (checkOut && checkOut > latest)) throw new ActionError("Corrected times can't be in the future")

    const site = await authorizedSite(prisma, actor, siteId)
    const employee = await assertOnRoster(prisma, site, String(employeeId || ""), actor.id)
    const day = toDateOnly(String(date))
    const record = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: day } } })
    if (record?.status === "LEAVE") throw new ActionError(`${employee.name} is on leave that day`)
    if (record) {
      const [pending] = await prisma.$queryRaw`SELECT id FROM "AttendanceCorrection" WHERE "attendanceId"=${record.id} AND status='PENDING' LIMIT 1`
      if (pending) throw new ActionError("A correction for this day is already waiting for review", 409)
    }
    const id = newId("cor")
    const text = `[Site Admin ${actor.name} · ${site.name}] ${reason}`.slice(0, 1000)
    await prisma.$executeRaw`
      INSERT INTO "AttendanceCorrection" ("id","organizationId","employeeId","attendanceId","requestedCheckInAt","requestedCheckOutAt","reason","requestedById")
      VALUES (${id},${actor.organizationId},${employee.id},${record?.id || null},${checkIn},${checkOut},${text},${actor.id})
    `
    logAudit({
      organizationId: actor.organizationId, actorId: actor.id, action: "attendance.site_admin_correction_requested", targetType: "User", targetId: employee.id,
      note: `${employee.name} ${date} — ${site.name}: ${reason}`,
    })
    notifyManagement({
      organizationId: actor.organizationId, createdById: actor.id, type: "REQUEST",
      title: "Attendance correction request", message: `${actor.name} (Site Admin) for ${employee.name}: ${reason.slice(0, 160)}`,
      link: "/attendance", moduleKey: "attendance",
    }).catch(() => {})
    res.status(201).json({ id, status: "PENDING" })
  } catch (err) {
    sendError(res, next, err)
  }
}

// GET /api/site-admin/history?from=&to= — the Site Admin's own activity,
// grouped by day and site (first/last action, employees, actions). Read
// from the action log, so it stays after moving to other sites.
async function getSiteAdminHistory(req, res, next) {
  try {
    const actor = await loadActor(req.user.userId)
    if (!actor) return res.status(403).json({ error: "Only an active Site Admin can use this" })
    const todayKey = dateKeyInTimeZone(new Date(), actor.timezone)
    const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : todayKey
    const defaultFrom = new Date(`${toKey}T00:00:00Z`)
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 13)
    const fromKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || "")) ? String(req.query.from) : defaultFrom.toISOString().slice(0, 10)
    if (fromKey > toKey) throw new ActionError("'From' must be on or before 'To'")
    if ((new Date(`${toKey}T00:00:00Z`) - new Date(`${fromKey}T00:00:00Z`)) / 86400000 > HISTORY_MAX_DAYS) throw new ActionError(`Pick at most ${HISTORY_MAX_DAYS} days`)
    // Pad by a day on each side for timezone offsets; grouped by local date below.
    const start = new Date(`${fromKey}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - 1)
    const end = new Date(`${toKey}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 2)

    const events = await prisma.attendancePresenceEvent.findMany({
      where: { actorId: actor.id, eventType: { startsWith: "SITE_ADMIN_" }, recordedAt: { gte: start, lt: end } },
      select: { siteId: true, projectId: true, employeeId: true, eventType: true, recordedAt: true, metadata: true, AttendanceSite: { select: { name: true, timezone: true } } },
      orderBy: { recordedAt: "asc" },
    })
    const groups = new Map()
    for (const e of events) {
      const tz = e.AttendanceSite?.timezone || actor.timezone
      const dateKey = dateKeyInTimeZone(e.recordedAt, actor.timezone)
      if (dateKey < fromKey || dateKey > toKey) continue
      const key = `${dateKey}|${e.siteId || e.metadata?.siteName || "deleted"}`
      if (!groups.has(key)) {
        groups.set(key, {
          date: dateKey,
          siteId: e.siteId,
          siteName: e.AttendanceSite?.name || e.metadata?.siteName || "Deleted site",
          projectName: e.metadata?.projectName || null,
          timezone: tz,
          firstAt: e.recordedAt,
          lastAt: e.recordedAt,
          employees: new Set(),
          actions: { CHECK_IN: 0, CHECK_OUT: 0, MARK_ABSENT: 0 },
          offline: 0,
        })
      }
      const g = groups.get(key)
      g.lastAt = e.recordedAt
      g.employees.add(e.employeeId)
      const action = e.eventType.replace("SITE_ADMIN_", "")
      g.actions[action] = (g.actions[action] || 0) + 1
      if (e.metadata?.source === "OFFLINE") g.offline += 1
    }
    const rows = [...groups.values()]
      .sort((a, b) => b.date.localeCompare(a.date) || new Date(a.firstAt) - new Date(b.firstAt))
      .map((g) => ({
        date: g.date,
        siteId: g.siteId,
        siteName: g.siteName,
        projectName: g.projectName,
        firstAt: g.firstAt,
        lastAt: g.lastAt,
        firstLabel: formatTime12(g.firstAt, g.timezone),
        lastLabel: formatTime12(g.lastAt, g.timezone),
        employeesManaged: g.employees.size,
        actions: g.actions,
        totalActions: Object.values(g.actions).reduce((s, n) => s + n, 0),
        offlineActions: g.offline,
      }))
    res.json({ from: fromKey, to: toKey, timezone: actor.timezone, rows })
  } catch (err) {
    sendError(res, next, err)
  }
}

module.exports = {
  listMySites,
  getSiteRoster,
  markSiteAttendance,
  syncSiteAttendance,
  requestSiteCorrection,
  getSiteAdminHistory,
  // for tests
  ActionError,
  geofenceCheck,
}
