const http = require("http")
const https = require("https")

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http
    const req = lib.get(url, { headers }, (r) => {
      let b = ""
      r.on("data", (c) => (b += c))
      r.on("end", () => { try { resolve(JSON.parse(b)) } catch { resolve(b) } })
    })
    req.on("error", reject)
    req.setTimeout(10000, () => req.destroy(new Error("timeout")))
  })
}

function createAdapter(config) {
  if (config.vendor === "HTTP" || config.connectionMode === "HTTP") return new HttpAdapter(config)
  if (config.vendor === "ZKTECO") return new ZktecoAdapter(config)
  return new UnsupportedAdapter(config)
}

// Every adapter's pullPunches(sinceIso) returns the full set of punches it
// can see (most device protocols don't support server-side "since"
// filtering) — index.js/sync.js keeps only the ones newer than the last
// synced watermark. sinceIso is passed through anyway so an adapter that CAN
// filter server-side (e.g. an HTTP device with a ?since= param) can use it
// to cut transfer size.

class HttpAdapter {
  constructor(c) { this.c = c }
  async pullPunches(sinceIso) {
    if (!this.c.ipAddress) throw new Error("HTTP device requires ipAddress or a custom adapter")
    const qs = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : ""
    const url = `http://${this.c.ipAddress}:${this.c.port || 80}/api/attendance${qs}`
    const data = await httpGet(url)
    const rows = Array.isArray(data) ? data : (data.punches || data.data || [])
    return rows.map((p, i) => ({
      externalUserId: String(p.externalUserId || p.userId || p.uid),
      occurredAt: p.occurredAt || p.timestamp || p.datetime,
      verification: p.verification || "biometric",
      externalId: String(p.externalId || `${p.userId || p.uid}:${p.timestamp || p.datetime || i}`),
      rawPayload: p,
    }))
  }
}

// Byte 31 of each 40-byte attendance record is the function key the user
// pressed before scanning: 0 = Check-In, 1 = Check-Out (2-5 are
// break/overtime keys on devices that have them). node-zklib's
// getAttendances() decodes only user id + time and drops it, so records are
// read raw here. Verified against a live K40: byte 31 was only ever 0 or 1,
// and matched real in/out patterns.
const PUNCH_STATE_OFFSET = 31
const RECORD_SIZE = 40

function directionFromPunchState(state) {
  if (state === 0) return "IN"
  if (state === 1) return "OUT"
  return null
}

class ZktecoAdapter {
  constructor(c) { this.c = c }
  async pullPunches() {
    let ZKLib, REQUEST_DATA, decodeRecordData40
    try {
      ZKLib = require("node-zklib")
      ;({ REQUEST_DATA } = require("node-zklib/constants"))
      ;({ decodeRecordData40 } = require("node-zklib/utils"))
    } catch { throw new Error("ZKTeco adapter requires 'node-zklib' in connector. Run npm install node-zklib") }
    const zk = new ZKLib(this.c.ipAddress, this.c.port || 4370, 10000, 4000, 0, "tcp")
    try {
      await zk.createSocket()
      const tcp = zk.zklibTcp
      try { await tcp.freeData() } catch { /* nothing buffered */ }
      const data = await tcp.readWithBuffer(REQUEST_DATA.GET_ATTENDANCE_LOGS)
      try { await tcp.freeData() } catch { /* nothing buffered */ }

      const rows = []
      let buf = data.data.subarray(4)
      while (buf.length >= RECORD_SIZE) {
        const raw = buf.subarray(0, RECORD_SIZE)
        rows.push({ ...decodeRecordData40(raw), punchState: raw[PUNCH_STATE_OFFSET] })
        buf = buf.subarray(RECORD_SIZE)
      }

      return rows
        .map((p) => ({
          externalUserId: String(p.deviceUserId ?? ""),
          occurredAt: p.recordTime,
          verification: "biometric",
          direction: directionFromPunchState(p.punchState),
          externalId: String(p.userSn),
          rawPayload: p,
        }))
        .filter((p) => p.externalUserId && p.occurredAt)
    } finally {
      try { await zk.disconnect() } catch { /* device may already be gone */ }
    }
  }

  // Opens one persistent connection and registers for the device's live
  // event stream (CMD_REG_EVENT) — the device notifies us the moment a punch
  // happens. onPunch is called once per punch; onError once if the
  // connection drops, so the caller can reconnect. Returns the underlying
  // zk handle so the caller can disconnect() on shutdown.
  //
  // The live event's decoder (decodeRecordRealTimeLog52) doesn't expose the
  // Check-In/Check-Out key either, and its byte layout isn't verified here —
  // so callers should treat this as a "something happened" signal and pull
  // via pullPunches() (verified direction) rather than send this punch as-is.
  async subscribeRealTime(onPunch, onError) {
    let ZKLib
    try { ZKLib = require("node-zklib") } catch { throw new Error("ZKTeco adapter requires 'node-zklib' in connector. Run npm install node-zklib") }
    const zk = new ZKLib(this.c.ipAddress, this.c.port || 4370, 10000, 4000, 0, "tcp")
    let closed = false
    const notifyClosed = (reason) => {
      if (closed) return
      closed = true
      if (onError) onError(new Error(`Device connection lost (${reason})`))
    }
    await zk.createSocket(
      (err) => notifyClosed(err?.message || "socket error"),
      () => notifyClosed("connection closed")
    )
    await zk.getRealTimeLogs((record) => {
      if (!record?.userId || !record?.attTime) return
      const occurredAt = new Date(record.attTime)
      if (Number.isNaN(occurredAt.getTime())) return
      onPunch({
        externalUserId: String(record.userId),
        occurredAt: occurredAt.toISOString(),
        verification: "biometric",
        externalId: `${record.userId}:${occurredAt.getTime()}`,
        rawPayload: record,
      })
    })
    return zk
  }
}

class UnsupportedAdapter {
  constructor(c) { this.c = c }
  async pullPunches() { throw new Error(`No built-in adapter for ${this.c.vendor}. Use PUSH/HTTP mode or install a vendor adapter.`) }
}

module.exports = { createAdapter }
