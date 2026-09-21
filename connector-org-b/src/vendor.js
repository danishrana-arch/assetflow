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

class ZktecoAdapter {
  constructor(c) { this.c = c }
  async pullPunches() {
    let ZKLib
    try { ZKLib = require("node-zklib") } catch { throw new Error("ZKTeco adapter requires 'node-zklib' in connector. Run npm install node-zklib") }
    const zk = new ZKLib(this.c.ipAddress, this.c.port || 4370, 10000, 4000, 0, "tcp")
    try {
      await zk.createSocket()
      const logs = await zk.getAttendances()
      const rows = logs?.data || logs || []
      return rows
        .map((p, i) => ({
          externalUserId: String(p.deviceUserId ?? p.user_id ?? p.userId ?? p.uid ?? ""),
          occurredAt: p.recordTime || p.record_time || p.timestamp || p.datetime || p.time,
          verification: String(p.type ?? p.state ?? "biometric"),
          externalId: String(p.userSn ?? p.uid ?? p.id ?? `${p.deviceUserId ?? p.user_id ?? p.userId}:${p.recordTime || p.record_time || p.timestamp || i}`),
          rawPayload: p,
        }))
        .filter((p) => p.externalUserId && p.occurredAt)
    } finally {
      try { await zk.disconnect() } catch { /* device may already be gone */ }
    }
  }

  // Opens one persistent connection and registers for the device's live
  // event stream (CMD_REG_EVENT) instead of re-pulling and re-decoding the
  // entire onboard log on a timer — the device pushes each new punch the
  // moment it happens. onPunch is called once per punch; onError once if the
  // connection drops, so the caller can reconnect. Returns the underlying
  // zk handle so the caller can disconnect() on shutdown.
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
