const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { siteDistance } = require("../utils/site-geofence")
const { toDateOnly } = require("../utils/date")
const { dateKeyInTimeZone, localMinutes, parseHHMM } = require("../utils/timezone")

function eventId(prefix = "ape") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`
}

function localDateFor(date, timezone) {
  return dateKeyInTimeZone(date, timezone || "UTC")
}

function inBreak(localMins, start, end) {
  const a = parseHHMM(start)
  const b = parseHHMM(end)
  if (a == null || b == null || a === b) return false
  return a < b ? localMins >= a && localMins < b : localMins >= a || localMins < b
}

async function assignedSites(employeeId, organizationId) {
  return prisma.$queryRaw`
    SELECT s.*, se."isPrimary"
    FROM "AttendanceSite" s
    LEFT JOIN "AttendanceSiteEmployee" se ON se."siteId"=s.id AND se."employeeId"=${employeeId}
    WHERE s."organizationId"=${organizationId}
      AND s.active=TRUE
      AND (se."employeeId" IS NOT NULL OR EXISTS (SELECT 1 FROM "ProjectMember" pm WHERE pm."projectId"=s."projectId" AND pm."employeeId"=${employeeId}))
    ORDER BY COALESCE(se."isPrimary",FALSE) DESC, s.name ASC
  `
}

function chooseSite(sites, latitude, longitude) {
  let best = null
  for (const site of sites) {
    const result = siteDistance(site, latitude, longitude)
    const candidate = { site, distance: result.distance, inside: result.inside, mode: result.mode }
    if (!best || (candidate.inside && !best.inside) || (candidate.inside === best.inside && candidate.distance < best.distance)) best = candidate
  }
  return best
}

async function getPresenceContext(req, res, next) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: { id: true, timezone: true, breakStart: true, breakEnd: true, shiftEndDefault: true, workingHoursPerDay: true },
    })
    if (!org) return res.status(404).json({ error: "Organization not found" })
    const sites = await assignedSites(req.user.userId, org.id)
    res.json({
      timezone: org.timezone || "UTC",
      breakStart: org.breakStart || null,
      breakEnd: org.breakEnd || null,
      shiftEnd: org.shiftEndDefault || null,
      sites: sites.map((s) => ({
        id: s.id, name: s.name, address: s.address, latitude: Number(s.latitude), longitude: Number(s.longitude),
        radiusMeters: Number(s.radiusMeters), timezone: s.timezone || org.timezone || "UTC", geofenceMode: s.geofenceMode, geofenceType: s.geofenceType || (s.boundary ? "POLYGON" : "RADIUS"), boundary: s.boundary || [], areaSqMeters: Number(s.areaSqMeters || 0), perimeterMeters: Number(s.perimeterMeters || 0),
        projectId: s.projectId || null, outsideGraceMinutes: Number(s.outsideGraceMinutes || 60), isPrimary: !!s.isPrimary,
      })),
    })
  } catch (err) { next(err) }
}

async function recordPresence(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { latitude, longitude, gpsAccuracy, recordedAt, clientEventId, source = "LIVE" } = req.body || {}
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return res.status(400).json({ error: "Valid latitude and longitude are required" })
    const when = recordedAt ? new Date(recordedAt) : new Date()
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "Invalid recordedAt" })

    const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true, breakStart: true, breakEnd: true } })
    const sites = await assignedSites(userId, organizationId)
    const best = chooseSite(sites, Number(latitude), Number(longitude))
    const localMins = localMinutes(when, org?.timezone || "UTC")
    const breakActive = inBreak(localMins, org?.breakStart, org?.breakEnd)

    const existingAttendance = await prisma.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: userId, date: toDateOnly(localDateFor(when, org?.timezone || "UTC")) } } })
    const effectiveInside = !!best?.inside
    const previous = existingAttendance ? await prisma.$queryRaw`
      SELECT inside, "recordedAt" FROM "AttendancePresenceEvent"
      WHERE "attendanceId"=${existingAttendance.id}
      ORDER BY "recordedAt" DESC LIMIT 1
    ` : []
    const previousInside = previous.length ? !!previous[0].inside : null
    const eventType = previousInside === null || previousInside !== effectiveInside
      ? (effectiveInside ? "GEOFENCE_ENTER" : "GEOFENCE_EXIT")
      : "LOCATION_SAMPLE"

    // Idempotent insert. State transitions are retained; repeated samples are retained only when they have a client ID.
    const id = eventId()
    const inserted = await prisma.$queryRaw`
      INSERT INTO "AttendancePresenceEvent"
        ("id","organizationId","employeeId","attendanceId","siteId","eventType","recordedAt","latitude","longitude","gpsAccuracy","distanceMeters","inside","clientEventId","metadata")
      VALUES
        (${id},${organizationId},${userId},${existingAttendance?.id || null},${best?.site?.id || null},${eventType},${when},${Number(latitude)},${Number(longitude)},${Number.isFinite(Number(gpsAccuracy)) ? Number(gpsAccuracy) : null},${best?.distance ?? null},${effectiveInside},${clientEventId || null},${JSON.stringify({ source, breakActive, siteName: best?.site?.name || null })}::jsonb)
      ON CONFLICT ("clientEventId") DO NOTHING
      RETURNING id
    `

    res.json({
      recorded: inserted.length > 0,
      inside: effectiveInside,
      breakActive,
      site: best ? { id: best.site.id, name: best.site.name, projectId: best.site.projectId || null, distanceMeters: Math.round(best.distance), radiusMeters: Number(best.site.radiusMeters), outsideGraceMinutes: Number(best.site.outsideGraceMinutes || 60) } : null,
      eventType,
      recordedAt: when.toISOString(),
    })
  } catch (err) { next(err) }
}

module.exports = { getPresenceContext, recordPresence }
