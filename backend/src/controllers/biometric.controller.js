const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { encryptField, decryptField } = require("../utils/crypto")
const { dateKeyInTimeZone, isWithinBreak, localDateKeyToUtc } = require("../utils/timezone")

const VENDORS = ["ZKTECO", "HIKVISION", "SUPREMA", "ANVIZ", "ESSL", "HTTP", "CUSTOM"]
const MODES = ["PULL", "PUSH", "HTTP"]

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function makeToken() {
  return `afc_${crypto.randomBytes(32).toString("hex")}`
}


function punchFingerprint({ deviceId, externalUserId, occurredAt }) {
  const time = new Date(occurredAt).getTime()
  return crypto.createHash("sha256").update(`${deviceId}|${String(externalUserId)}|${time}`).digest("hex")
}

async function syncAttendanceFromPunches({ organizationId, employeeId, deviceId, occurredAt }) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true, breakStart: true, breakEnd: true },
  })
  const timeZone = organization?.timezone || "UTC"
  const dateKey = dateKeyInTimeZone(occurredAt, timeZone)
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  const punchRangeStart = localDateKeyToUtc(dateKey, timeZone)
  const nextLocalDay = new Date(`${dateKey}T00:00:00.000Z`)
  nextLocalDay.setUTCDate(nextLocalDay.getUTCDate() + 1)
  const nextDateKey = nextLocalDay.toISOString().slice(0, 10)
  const punchRangeEnd = localDateKeyToUtc(nextDateKey, timeZone)


  // Punches made during the configured break are ignored for IN/OUT
  // purposes. The break is treated as office time, so an accidental
  // checkout during lunch cannot become the day's checkout.
  const punches = await prisma.biometricPunch.findMany({
    where: {
      organizationId,
      employeeId,
      occurredAt: { gte: punchRangeStart, lt: punchRangeEnd },
    },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true, direction: true },
  })
  const effectivePunches = punches.filter((p) => !isWithinBreak(p.occurredAt, timeZone, organization?.breakStart, organization?.breakEnd))
  if (!effectivePunches.length) return

  // Only meaningful when at least one punch this day actually carries a
  // direction — today that's ADMS only; the PULL/connector path can't
  // report a button press at all (node-zklib exposes no status byte), so
  // every one of its punches has direction=null. If we required direction
  // unconditionally, PULL-synced attendance would never be marked at all.
  const directional = effectivePunches.filter((p) => p.direction === "IN" || p.direction === "OUT")

  let checkInAt, checkOutAt, workingMinutes
  if (directional.length) {
    // A device that's actually reporting button presses this day: a bare
    // scan with no IN/OUT (e.g. just unlocking a door) is excluded here,
    // not guessed at from ordering.
    checkInAt = directional.find((p) => p.direction === "IN")?.occurredAt || null
    checkOutAt = [...directional].reverse().find((p) => p.direction === "OUT")?.occurredAt || null

    workingMinutes = null
    if (directional.some((p) => p.direction === "OUT")) {
      let total = 0
      let openInAt = null
      for (const p of directional) {
        if (p.direction === "IN") {
          openInAt = p.occurredAt
        } else if (p.direction === "OUT" && openInAt) {
          total += Math.max(0, Math.round((p.occurredAt.getTime() - openInAt.getTime()) / 60000))
          openInAt = null
        }
      }
      workingMinutes = total
    }
  } else {
    // No device involved today reports a direction at all — fall back to
    // the original order-based guess (first punch = in, last = out) so
    // attendance still gets marked for PULL-mode devices.
    checkInAt = effectivePunches[0].occurredAt
    checkOutAt = effectivePunches.length > 1 ? effectivePunches[effectivePunches.length - 1].occurredAt : null
    workingMinutes = null
    if (effectivePunches.length >= 2) {
      let total = 0
      for (let i = 0; i + 1 < effectivePunches.length; i += 2) {
        total += Math.max(0, Math.round((effectivePunches[i + 1].occurredAt.getTime() - effectivePunches[i].occurredAt.getTime()) / 60000))
      }
      workingMinutes = total
    }
  }

  await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: { status: "PRESENT", source: "BIOMETRIC", biometricDeviceId: deviceId, checkInAt, checkOutAt, workingMinutes },
    create: { organizationId, employeeId, date, status: "PRESENT", source: "BIOMETRIC", biometricDeviceId: deviceId, checkInAt, checkOutAt, workingMinutes },
  })
}

// Biometric device management lives under Settings, which is ADMIN/CEO-only
// now (RequireOwner no longer includes MANAGER) — plus the legacy per-user
// canManageAttendance override, which predates the module system and stays
// as an admin-grantable escape hatch regardless of role.
function management(req) {
  return ["ADMIN", "CEO"].includes(req.user?.role) || !!req.user?.canManageAttendance
}

async function listDevices(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const devices = await prisma.biometricDevice.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { mappings: true, punches: true } } },
    })
    res.json(devices.map(d => ({ ...d, relaySecret: undefined, communicationKey: undefined, connectorTokenHash: undefined })))
  } catch (e) { next(e) }
}

async function createDevice(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const { name, vendor, model, serialNumber, ipAddress, port, connectionMode, doorEnabled, unlockSeconds, relayUrl, relaySecret, communicationKey } = req.body
    if (!name || !VENDORS.includes(vendor)) return res.status(400).json({ error: "name and supported vendor are required" })
    if (connectionMode && !MODES.includes(connectionMode)) return res.status(400).json({ error: "Invalid connection mode" })
    const token = makeToken()
    const device = await prisma.biometricDevice.create({
      data: {
        organizationId: req.user.organizationId, name, vendor, model: model || null, serialNumber: serialNumber || null,
        ipAddress: ipAddress || null, port: port ? Number(port) : null, connectionMode: connectionMode || "PULL",
        doorEnabled: !!doorEnabled, unlockSeconds: Math.max(1, Math.min(120, Number(unlockSeconds || 5))),
        relayUrl: relayUrl || null, relaySecret: relaySecret ? encryptField(relaySecret) : null,
        communicationKey: communicationKey ? encryptField(communicationKey) : null,
        connectorTokenHash: hashToken(token), connectorTokenCreatedAt: new Date(),
      },
    })
    res.status(201).json({ device: { ...device, relaySecret: undefined, communicationKey: undefined, connectorTokenHash: undefined }, connectorToken: token })
  } catch (e) {
    if (e?.code === "P2002" && e?.meta?.target?.includes?.("serialNumber")) {
      return res.status(400).json({ error: "That serial number is already registered to a device on this deployment" })
    }
    next(e)
  }
}

async function rotateToken(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!device) return res.status(404).json({ error: "Device not found" })
    const token = makeToken()
    await prisma.biometricDevice.update({ where: { id: device.id }, data: { connectorTokenHash: hashToken(token), connectorTokenCreatedAt: new Date() } })
    res.json({ connectorToken: token })
  } catch (e) { next(e) }
}

async function updateDevice(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!device) return res.status(404).json({ error: "Device not found" })
    const b = req.body
    const data = {}
    for (const k of ["name", "vendor", "model", "serialNumber", "ipAddress", "connectionMode", "relayUrl"]) if (b[k] !== undefined) data[k] = b[k] || null
    if (b.port !== undefined) data.port = b.port ? Number(b.port) : null
    if (b.enabled !== undefined) data.enabled = !!b.enabled
    if (b.doorEnabled !== undefined) data.doorEnabled = !!b.doorEnabled
    if (b.unlockSeconds !== undefined) data.unlockSeconds = Math.max(1, Math.min(120, Number(b.unlockSeconds)))
    if (b.relaySecret !== undefined) data.relaySecret = b.relaySecret ? encryptField(b.relaySecret) : null
    if (b.communicationKey !== undefined) data.communicationKey = b.communicationKey ? encryptField(b.communicationKey) : null
    const updated = await prisma.biometricDevice.update({ where: { id: device.id }, data })
    res.json({ ...updated, relaySecret: undefined, communicationKey: undefined, connectorTokenHash: undefined })
  } catch (e) {
    if (e?.code === "P2002" && e?.meta?.target?.includes?.("serialNumber")) {
      return res.status(400).json({ error: "That serial number is already registered to a device on this deployment" })
    }
    next(e)
  }
}

async function deleteDevice(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!device) return res.status(404).json({ error: "Device not found" })
    await prisma.biometricDevice.delete({ where: { id: device.id } })
    res.json({ ok: true })
  } catch (e) { next(e) }
}

async function connectorAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : req.headers["x-connector-token"]
    if (!token) return res.status(401).json({ error: "Connector token required" })
    const hash = hashToken(token)
    const device = await prisma.biometricDevice.findFirst({ where: { connectorTokenHash: hash, enabled: true } })
    if (!device) return res.status(401).json({ error: "Invalid connector token" })
    req.biometricDevice = device
    next()
  } catch (e) { next(e) }
}

async function connectorConfig(req, res) {
  const d = req.biometricDevice
  const mappings = await prisma.biometricDeviceEmployee.findMany({ where: { deviceId: d.id }, select: { externalUserId: true, employeeId: true } })
  res.json({ id: d.id, name: d.name, vendor: d.vendor, model: d.model, serialNumber: d.serialNumber, ipAddress: d.ipAddress, port: d.port, connectionMode: d.connectionMode, doorEnabled: d.doorEnabled, unlockSeconds: d.unlockSeconds, relayUrl: d.relayUrl, relaySecret: d.relaySecret ? decryptField(d.relaySecret) : null, mappings })
}

async function heartbeat(req, res, next) {
  try {
    await prisma.biometricDevice.update({ where: { id: req.biometricDevice.id }, data: { lastSeenAt: new Date(), lastError: null } })
    res.json({ ok: true, serverTime: new Date().toISOString() })
  } catch (e) { next(e) }
}

// Shared by both ingestion paths: the token-authenticated connector endpoint
// (POST /connector/punches) and the SN-identified ADMS push endpoint
// (POST /iclock/cdata). A device can hand us thousands of historical punches
// in one batch (a fresh device with no watermark yet syncs its whole log, or
// an ADMS device that was offline a while). Doing a findFirst + mapping
// lookup + attendance recompute per punch is one to several DB round trips
// each, which does not survive a large backfill within any reasonable
// request timeout — so dedupe and mapping lookups are two bulk queries
// instead of N, and attendance recompute collapses to once per
// (employee, calendar day) actually touched instead of once per punch.
async function ingestPunchBatch(device, punches) {
  // Only today's punches (in the organization's local time) are ever
  // stored or processed — a first-ever connector sync, or a backlogged
  // ADMS retry, can hand over months of history in one batch, and none of
  // that should retroactively create or rewrite past days' attendance.
  const organization = await prisma.organization.findUnique({ where: { id: device.organizationId }, select: { timezone: true } })
  const timeZone = organization?.timezone || "UTC"
  const todayKey = dateKeyInTimeZone(new Date(), timeZone)

  const candidates = []
  const batchFingerprints = new Set()
  let duplicates = 0
  let skippedOld = 0
  for (const p of punches) {
    if (!p.externalUserId || !p.occurredAt) continue
    const occurredAt = new Date(p.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) continue
    if (dateKeyInTimeZone(occurredAt, timeZone) !== todayKey) {
      skippedOld++
      continue
    }

    const fingerprint = punchFingerprint({ deviceId: device.id, externalUserId: p.externalUserId, occurredAt })
    if (batchFingerprints.has(fingerprint)) {
      duplicates++
      continue
    }
    batchFingerprints.add(fingerprint)
    candidates.push({ p, occurredAt, fingerprint, externalId: p.externalId ? String(p.externalId) : null })
  }

  if (!candidates.length) {
    await prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastSyncAt: new Date(), lastError: null } })
    return { accepted: 0, duplicates, unmatched: 0, skippedOld }
  }

  const externalIds = candidates.map((c) => c.externalId).filter(Boolean)
  const existing = await prisma.biometricPunch.findMany({
    where: {
      deviceId: device.id,
      OR: [
        { fingerprint: { in: candidates.map((c) => c.fingerprint) } },
        ...(externalIds.length ? [{ externalId: { in: externalIds } }] : []),
      ],
    },
    select: { fingerprint: true, externalId: true },
  })
  const existingFingerprints = new Set(existing.map((e) => e.fingerprint))
  const existingExternalIds = new Set(existing.filter((e) => e.externalId).map((e) => e.externalId))

  const mappings = await prisma.biometricDeviceEmployee.findMany({ where: { deviceId: device.id }, select: { externalUserId: true, employeeId: true } })
  const employeeByExternalId = new Map(mappings.map((m) => [m.externalUserId, m.employeeId]))

  const toInsert = []
  let unmatched = 0
  for (const c of candidates) {
    if (existingFingerprints.has(c.fingerprint) || (c.externalId && existingExternalIds.has(c.externalId))) {
      duplicates++
      continue
    }
    const employeeId = employeeByExternalId.get(String(c.p.externalUserId)) || null
    if (!employeeId) unmatched++
    toInsert.push({
      organizationId: device.organizationId,
      deviceId: device.id,
      employeeId,
      externalUserId: String(c.p.externalUserId),
      occurredAt: c.occurredAt,
      verification: c.p.verification || null,
      direction: c.p.direction === "IN" || c.p.direction === "OUT" ? c.p.direction : null,
      externalId: c.externalId,
      fingerprint: c.fingerprint,
      rawPayload: c.p.rawPayload || c.p,
    })
  }

  // skipDuplicates covers the rare race where a concurrent retry inserted
  // the same fingerprint/externalId between our lookup above and this call.
  if (toInsert.length) await prisma.biometricPunch.createMany({ data: toInsert, skipDuplicates: true })
  const accepted = toInsert.length

  // Every row in toInsert already passed the today-only filter above, so
  // this only ever recomputes today's attendance — never a backfilled past day.
  const seenEmployeeDays = new Set()
  for (const row of toInsert) {
    if (!row.employeeId) continue
    const key = `${row.employeeId}|${dateKeyInTimeZone(row.occurredAt, timeZone)}`
    if (seenEmployeeDays.has(key)) continue
    seenEmployeeDays.add(key)
    await syncAttendanceFromPunches({ organizationId: device.organizationId, employeeId: row.employeeId, deviceId: device.id, occurredAt: row.occurredAt })
  }

  await prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastSyncAt: new Date(), lastError: null } })
  return { accepted, duplicates, unmatched, skippedOld }
}

async function ingestPunches(req, res, next) {
  try {
    const device = req.biometricDevice
    const punches = Array.isArray(req.body.punches) ? req.body.punches : [req.body]
    const result = await ingestPunchBatch(device, punches)
    res.json(result)
  } catch (e) { next(e) }
}

async function mapEmployee(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    const employee = await prisma.user.findFirst({ where: { id: req.body.employeeId, organizationId: req.user.organizationId } })
    if (!device || !employee || !req.body.externalUserId) return res.status(404).json({ error: "Device or employee not found" })
    const externalUserId = String(req.body.externalUserId)
    const mapping = await prisma.biometricDeviceEmployee.upsert({
      where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
      update: { externalUserId },
      create: { deviceId: device.id, employeeId: employee.id, externalUserId },
    })

    // Punches for this device user ID may already have arrived and been
    // stored unmatched (employeeId: null) before this mapping existed —
    // that never resolves itself automatically (the connector's watermark
    // means it won't re-send them, and the ingest dedup check would skip
    // them as duplicates even if it did). Attach today's already-stored
    // ones now and recompute attendance so mapping an employee actually
    // takes effect immediately instead of only for punches from this point on.
    const organization = await prisma.organization.findUnique({ where: { id: device.organizationId }, select: { timezone: true } })
    const timeZone = organization?.timezone || "UTC"
    const todayKey = dateKeyInTimeZone(new Date(), timeZone)
    const punchRangeStart = localDateKeyToUtc(todayKey, timeZone)
    const tomorrow = new Date(`${todayKey}T00:00:00.000Z`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    const punchRangeEnd = localDateKeyToUtc(tomorrow.toISOString().slice(0, 10), timeZone)

    const backfilled = await prisma.biometricPunch.updateMany({
      where: { deviceId: device.id, externalUserId, employeeId: null, occurredAt: { gte: punchRangeStart, lt: punchRangeEnd } },
      data: { employeeId: employee.id },
    })
    if (backfilled.count > 0) {
      await syncAttendanceFromPunches({ organizationId: device.organizationId, employeeId: employee.id, deviceId: device.id, occurredAt: new Date() })
    }

    res.json({ ...mapping, backfilledPunches: backfilled.count })
  } catch (e) { next(e) }
}

async function listMappings(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!device) return res.status(404).json({ error: "Device not found" })
    const mappings = await prisma.biometricDeviceEmployee.findMany({ where: { deviceId: device.id }, include: { employee: { select: { id: true, name: true, email: true, status: true } } } })
    res.json(mappings)
  } catch (e) { next(e) }
}

module.exports = { listDevices, createDevice, rotateToken, updateDevice, deleteDevice, connectorAuth, connectorConfig, heartbeat, ingestPunches, ingestPunchBatch, mapEmployee, listMappings }
