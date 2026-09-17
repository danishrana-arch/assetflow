const http = require("http")
const axios = require("axios")
const cfg = require("./config")
const logger = require("./logger")
const { createAdapter } = require("./vendor")
const { syncOnce } = require("./sync")

const client = axios.create({
  baseURL: cfg.API,
  timeout: 20000,
  headers: { "X-Connector-Token": cfg.TOKEN },
})

let config = null
let adapter = null
let syncInFlight = false
let stopping = false
let realtimeHandle = null
let realtimeReconnectTimer = null

// --- retry/backoff helper -------------------------------------------------
// Any network or device call in this service goes through here so a flaky
// LAN link or a brief backend outage doesn't kill the process — it backs off
// exponentially (capped) and keeps trying instead of crash-looping.
async function withRetry(label, fn, { attempts = cfg.RETRY_MAX_ATTEMPTS } = {}) {
  let delay = cfg.RETRY_BASE_MS
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === attempts) {
        logger.error(`${label} failed after ${attempts} attempt(s), giving up until next cycle`, { error: e.message })
        throw e
      }
      logger.warn(`${label} failed (attempt ${i}/${attempts}), retrying in ${Math.round(delay / 1000)}s`, { error: e.message })
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, cfg.RETRY_MAX_MS)
    }
  }
}

async function loadConfig() {
  const r = await client.get("/connector/config")
  config = r.data
  adapter = createAdapter(config)
  logger.info("Connector configured", { device: config.name, vendor: config.vendor, model: config.model || "unknown", mode: config.connectionMode })
}

async function heartbeat() {
  try {
    await client.post("/connector/heartbeat")
    logger.debug("Heartbeat ok")
  } catch (e) {
    logger.warn("Heartbeat failed", { error: e.message })
  }
}

async function runSyncCycle() {
  if (syncInFlight || !adapter) return
  syncInFlight = true
  try {
    await withRetry("Sync", () => syncOnce({ config, adapter, client }))
  } catch {
    // withRetry already logged the final failure; the next scheduled cycle
    // (or the next push) will try again — nothing further to do here.
  } finally {
    syncInFlight = false
  }
}

// --- real-time subscription (ZKTECO PULL devices only) ---------------------
// When the adapter supports it, this replaces periodic full-log re-pulling
// as the primary feed: one persistent connection, device pushes each punch
// the instant it happens. The regular setInterval(runSyncCycle, ...) cycle
// keeps running underneath as a reconciliation pass — it'll pick up
// anything missed during a disconnect (or before this subscription existed
// at all), it just no longer has to be the fast/frequent path.
async function startRealtime() {
  if (stopping || !adapter || typeof adapter.subscribeRealTime !== "function") return
  try {
    realtimeHandle = await adapter.subscribeRealTime(
      async (punch) => {
        try {
          await client.post("/connector/punches", { punches: [punch] })
          logger.info("Live punch synced", { device: config.name, externalUserId: punch.externalUserId, occurredAt: punch.occurredAt })
        } catch (e) {
          logger.warn("Failed to push a live punch — the next reconciliation cycle will pick it up", { error: e.message })
        }
      },
      (err) => {
        logger.warn("Real-time connection dropped, will reconnect", { device: config.name, error: err.message })
        realtimeHandle = null
        scheduleRealtimeReconnect()
      }
    )
    logger.info("Real-time punch subscription active", { device: config.name })
  } catch (e) {
    logger.warn("Could not start real-time subscription, relying on periodic sync only", { error: e.message })
    scheduleRealtimeReconnect()
  }
}

function scheduleRealtimeReconnect() {
  if (realtimeReconnectTimer || stopping) return
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null
    startRealtime()
  }, cfg.RETRY_BASE_MS)
}

// --- local push receiver ---------------------------------------------------
// For PUSH-mode devices/relays that call us directly instead of waiting to
// be polled. Punches arriving this way still go through door-unlock +
// dedup on the backend exactly like a polled cycle.
function startPushServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/device/punches") {
      res.writeHead(404)
      return res.end()
    }
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}")
        const punches = Array.isArray(payload.punches) ? payload.punches : [payload]
        if (config?.doorEnabled && config.relayUrl) {
          const { unlockDoor } = require("./door")
          const mapped = new Set((config.mappings || []).map((m) => String(m.externalUserId)))
          for (const punch of punches) {
            if (mapped.has(String(punch.externalUserId))) await unlockDoor(config.relayUrl, config.relaySecret, config.unlockSeconds)
          }
        }
        await client.post("/connector/punches", { punches })
        logger.info(`Received ${punches.length} pushed punch(es)`)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, accepted: punches.length }))
      } catch (e) {
        logger.error("Push receiver error", { error: e.message })
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  })
  server.listen(cfg.PUSH_PORT, "0.0.0.0", () => logger.info(`Local biometric push receiver listening on :${cfg.PUSH_PORT}`))
  return server
}

let syncTimer = null
let heartbeatTimer = null

async function main() {
  logger.info("AssetFlow Attendance Connector starting", {
    api: cfg.API,
    pollIntervalMinutes: Math.round(cfg.POLL_INTERVAL_MS / 60000),
  })
  await withRetry("Initial config load", loadConfig, { attempts: 10 })
  await runSyncCycle()
  await startRealtime()
  if (realtimeHandle) {
    logger.info(`Periodic sync every ${Math.round(cfg.POLL_INTERVAL_MS / 60000)}m now runs as a reconciliation pass alongside the live subscription`)
  }

  syncTimer = setInterval(runSyncCycle, cfg.POLL_INTERVAL_MS)
  heartbeatTimer = setInterval(heartbeat, cfg.HEARTBEAT_INTERVAL_MS)
  const pushServer = startPushServer()

  const shutdown = (signal) => {
    if (stopping) return
    stopping = true
    logger.info(`Received ${signal}, shutting down gracefully`)
    clearInterval(syncTimer)
    clearInterval(heartbeatTimer)
    if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer)
    if (realtimeHandle) { try { realtimeHandle.disconnect() } catch { /* already gone */ } }
    pushServer.close(() => {
      logger.info("Shutdown complete")
      process.exit(0)
    })
    // Force-exit if something hangs on close
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on("SIGINT", () => shutdown("SIGINT"))
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("unhandledRejection", (e) => logger.error("Unhandled rejection", { error: e?.message || String(e) }))
}

main().catch((e) => {
  logger.error("Fatal startup error", { error: e.message })
  process.exit(1)
})
