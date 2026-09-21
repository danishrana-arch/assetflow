const prisma = require("../lib/prisma")
const { ingestPunchBatch } = require("./biometric.controller")
const { localDateTimeToUtc } = require("../utils/timezone")

// ADMS is the push protocol ZKTeco (and several compatible-vendor) devices
// speak natively once pointed at a server via their own Comm > ADMS/Cloud
// Server menu: the device becomes the client, POSTing each new punch here as
// it happens, no polling required on our side at all. It is not JSON — it's
// a plain-text, reverse-engineered-by-the-community protocol (ZKTeco never
// published a formal spec).
//
// Multi-tenancy: the device's "Server URL" field is just a base string that
// the firmware appends its own fixed "/iclock/..." suffix onto, so a
// customer's own organization slug goes in front of that as a path segment
// — e.g. Server URL "yourdomain.com/assetflow/cloudnext360" makes the device
// request ".../assetflow/cloudnext360/iclock/cdata". That resolves the
// organization unambiguously before a device is even looked up, so unlike
// serial-number-only matching, two organizations' devices can never be
// confused with each other regardless of what serial numbers they carry.
async function findOrgBySlug(slug) {
  if (!slug) return null
  return prisma.organization.findUnique({ where: { slug: String(slug) } })
}

async function findDeviceBySerial(organizationId, sn) {
  if (!sn) return null
  return prisma.biometricDevice.findFirst({ where: { organizationId, serialNumber: String(sn), enabled: true } })
}

// GET /assetflow/:orgSlug/iclock/cdata — handshake a device performs on
// boot/registration (no `table` query param) to fetch its sync options.
// Realtime=1 is what tells the device to push each punch immediately instead
// of only on its own internal schedule; the rest are conservative defaults
// widely documented across community ADMS implementations. The exact
// accepted format is firmware-dependent and not officially published, so
// this is a best-effort baseline to verify against the real device once it's
// pointed here.
async function cdataHandshake(req, res) {
  const org = await findOrgBySlug(req.params.orgSlug)
  if (!org) return res.status(200).type("text/plain").send("ERROR: unknown organization")
  const sn = req.query.SN
  const device = await findDeviceBySerial(org.id, sn)
  if (!device) return res.status(200).type("text/plain").send("ERROR: unregistered SN")

  const lines = [
    `GET OPTION FROM: SN=${sn}`,
    "Stamp=9999",
    "OpStamp=9999",
    "ATTLOGStamp=9999",
    "ErrorDelay=60",
    "Delay=30",
    "TransTimes=00:00",
    "TransInterval=1",
    "TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser",
    "Realtime=1",
    "Encrypt=0",
  ]
  res.type("text/plain").send(lines.join("\n"))
}

// POST /iclock/cdata?SN=...&table=ATTLOG — the actual punch upload. Body is
// plain text, one record per line, tab-separated:
//   PIN <tab> DateTime <tab> Status <tab> Verify <tab> ...(ignored)
// DateTime has no timezone marker — it's the device's own local clock. That
// only means what it looks like relative to the organization's configured
// timezone (the device is physically sitting in that org's office), not the
// server process's own OS timezone — using plain `new Date(str)` here would
// silently produce wrong-by-hours timestamps on a cloud host set to UTC.
async function cdataUpload(req, res) {
  const org = await findOrgBySlug(req.params.orgSlug)
  if (!org) return res.status(200).type("text/plain").send("ERROR: unknown organization")
  const sn = req.query.SN
  const table = req.query.table || ""
  const device = await findDeviceBySerial(org.id, sn)
  if (!device) return res.status(200).type("text/plain").send("ERROR: unregistered SN")

  if (table.toUpperCase() !== "ATTLOG") {
    // OPLOG / other tables aren't attendance data — accept and ignore so the
    // device doesn't retry them forever, but don't try to parse them as punches.
    return res.type("text/plain").send("OK")
  }

  const organization = await prisma.organization.findUnique({ where: { id: device.organizationId }, select: { timezone: true } })
  const timeZone = organization?.timezone || "UTC"

  const body = typeof req.body === "string" ? req.body : ""
  const punches = body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pin, dateTime, status, verify] = line.split("\t")
      if (!pin || !dateTime) return null
      const occurredAt = localDateTimeToUtc(dateTime, timeZone)
      if (Number.isNaN(occurredAt.getTime())) return null
      // ATTLOG's Status is the device's own IN/OUT function-key press: the
      // widely-used convention is 0=Check In, 1=Check Out (2-5 cover
      // break/overtime keys some devices have, which this doesn't try to
      // interpret as a primary in/out marker).
      const direction = status === "0" ? "IN" : status === "1" ? "OUT" : null
      return {
        externalUserId: pin,
        occurredAt: occurredAt.toISOString(),
        verification: verify || null,
        direction,
        externalId: `${pin}:${occurredAt.getTime()}:${status || ""}`,
        rawPayload: { pin, dateTime, status, verify, raw: line },
      }
    })
    .filter(Boolean)

  if (punches.length) await ingestPunchBatch(device, punches)
  res.type("text/plain").send("OK")
}

// GET /iclock/getrequest — the device periodically asks whether the server
// has any queued commands (remote enroll, reboot, etc.) for it. This
// implementation doesn't queue any, so it always answers "no commands".
async function getrequest(req, res) {
  res.type("text/plain").send("OK")
}

// POST /iclock/devicecmd — acknowledgement of a command's execution result.
// Never queued here, but answered anyway so a device that sends one
// unprompted doesn't treat it as an error.
async function devicecmd(req, res) {
  res.type("text/plain").send("OK")
}

module.exports = { cdataHandshake, cdataUpload, getrequest, devicecmd }
