const crypto = require("crypto")
const prisma = require("../lib/prisma")
const { encryptField, decryptField } = require("../utils/crypto")

const VENDORS = ["ZKTECO", "HIKVISION", "SUPREMA", "ANVIZ", "ESSL", "HTTP", "CUSTOM"]
const MODES = ["PULL", "PUSH", "HTTP"]

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function makeToken() {
  return `afc_${crypto.randomBytes(32).toString("hex")}`
}


async function syncAttendanceFromPunches({ organizationId, employeeId, deviceId, occurredAt }) {
  const date = new Date(Date.UTC(
    occurredAt.getUTCFullYear(),
    occurredAt.getUTCMonth(),
    occurredAt.getUTCDate()
  ))
  const nextDate = new Date(date)
  nextDate.setUTCDate(nextDate.getUTCDate() + 1)

  const punches = await prisma.biometricPunch.findMany({
    where: {
      organizationId,
      employeeId,
      occurredAt: { gte: date, lt: nextDate },
    },
    orderBy: { occurredAt: "asc" },
    select: { occurredAt: true },
  })

  if (!punches.length) return

  const checkInAt = punches[0].occurredAt
  const checkOutAt = punches.length > 1 ? punches[punches.length - 1].occurredAt : null
  const workingMinutes = checkOutAt
    ? Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000))
    : null

  await prisma.attendanceRecord.upsert({
    where: { employeeId_date: { employeeId, date } },
    update: {
      status: "PRESENT",
      source: "BIOMETRIC",
      biometricDeviceId: deviceId,
      checkInAt,
      checkOutAt,
      workingMinutes,
    },
    create: {
      organizationId,
      employeeId,
      date,
      status: "PRESENT",
      source: "BIOMETRIC",
      biometricDeviceId: deviceId,
      checkInAt,
      checkOutAt,
      workingMinutes,
    },
  })
}

function management(req) {
  return req.user?.role === "ADMIN" || req.user?.role === "CEO" || !!req.user?.canManageAttendance
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
  } catch (e) { next(e) }
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
  } catch (e) { next(e) }
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

async function ingestPunches(req, res, next) {
  try {
    const device = req.biometricDevice
    const punches = Array.isArray(req.body.punches) ? req.body.punches : [req.body]
    let accepted = 0, duplicates = 0, unmatched = 0
    for (const p of punches) {
      if (!p.externalUserId || !p.occurredAt) continue
      const externalId = p.externalId || `${p.externalUserId}:${new Date(p.occurredAt).toISOString()}`
      const existing = await prisma.biometricPunch.findFirst({ where: { deviceId: device.id, externalId } })
      if (existing) { duplicates++; continue }
      const mapping = await prisma.biometricDeviceEmployee.findFirst({ where: { deviceId: device.id, externalUserId: String(p.externalUserId) } })
      const occurredAt = new Date(p.occurredAt)
      const punch = await prisma.biometricPunch.create({ data: { organizationId: device.organizationId, deviceId: device.id, employeeId: mapping?.employeeId || null, externalUserId: String(p.externalUserId), occurredAt, verification: p.verification || null, externalId, rawPayload: p.rawPayload || p } })
      accepted++
      if (!mapping) { unmatched++; continue }
      await syncAttendanceFromPunches({
        organizationId: device.organizationId,
        employeeId: mapping.employeeId,
        deviceId: device.id,
        occurredAt,
      })
      if (device.doorEnabled) {
        // The connector performs the physical unlock locally. The cloud event tells it to unlock after a valid mapped punch.
      }
    }
    await prisma.biometricDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), lastSyncAt: new Date(), lastError: null } })
    res.json({ accepted, duplicates, unmatched })
  } catch (e) { next(e) }
}

async function mapEmployee(req, res, next) {
  try {
    if (!management(req)) return res.status(403).json({ error: "Biometric device access is restricted" })
    const device = await prisma.biometricDevice.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    const employee = await prisma.user.findFirst({ where: { id: req.body.employeeId, organizationId: req.user.organizationId } })
    if (!device || !employee || !req.body.externalUserId) return res.status(404).json({ error: "Device or employee not found" })
    const mapping = await prisma.biometricDeviceEmployee.upsert({ where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } }, update: { externalUserId: String(req.body.externalUserId) }, create: { deviceId: device.id, employeeId: employee.id, externalUserId: String(req.body.externalUserId) } })
    res.json(mapping)
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

module.exports = { listDevices, createDevice, rotateToken, updateDevice, deleteDevice, connectorAuth, connectorConfig, heartbeat, ingestPunches, mapEmployee, listMappings }
