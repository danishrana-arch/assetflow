require("dotenv").config()
const axios = require("axios")
const http = require("http")
const { createAdapter } = require("./vendor")
const { unlockDoor } = require("./door")

const API = (process.env.ASSETFLOW_API_URL || "http://localhost:4000/api/biometric").replace(/\/$/, "")
const TOKEN = process.env.CONNECTOR_TOKEN
const INTERVAL = Number(process.env.POLL_INTERVAL_MS || 30000)
if (!TOKEN) { console.error("CONNECTOR_TOKEN is required"); process.exit(1) }
const client = axios.create({ baseURL: API, timeout: 15000, headers: { "X-Connector-Token": TOKEN } })
let config = null
let adapter = null
let running = false

async function loadConfig() {
  const r = await client.get("/connector/config")
  config = r.data
  adapter = createAdapter(config)
  console.log(`AssetFlow connector: ${config.name} (${config.vendor}/${config.model || "unknown"})`)
}
async function heartbeat() { try { await client.post("/connector/heartbeat") } catch(e) { console.error("heartbeat:", e.message) } }
async function sendPunches(punches) {
  if (!punches?.length) return
  await client.post("/connector/punches", { punches })
  console.log(`sent ${punches.length} punch(es)`)
}
async function poll() {
  if (running || !adapter) return
  running = true
  try {
    const punches = await adapter.pullPunches()
    if (config.doorEnabled && config.relayUrl) {
      const mapped = new Set((config.mappings || []).map(m => String(m.externalUserId)))
      for (const punch of punches) {
        if (mapped.has(String(punch.externalUserId))) {
          await unlockDoor(config.relayUrl, config.relaySecret, config.unlockSeconds)
        }
      }
    }
    await sendPunches(punches)
    await heartbeat()
  } catch (e) { console.error("sync:", e.message) }
  finally { running = false }
}
async function main() {
  await loadConfig()
  await poll()
  setInterval(poll, INTERVAL)
  setInterval(heartbeat, Math.max(10000, Math.floor(INTERVAL/2)))
}

const PUSH_PORT = Number(process.env.LOCAL_PUSH_PORT || 8787)
const pushServer = require("http").createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/device/punches") { res.writeHead(404); return res.end() }
  let body=""; req.on("data", c => body += c); req.on("end", async () => {
    try {
      const payload = JSON.parse(body || "{}")
      const punches = Array.isArray(payload.punches) ? payload.punches : [payload]
      if (config?.doorEnabled && config.relayUrl) {
        const mapped = new Set((config.mappings || []).map(m => String(m.externalUserId)))
        for (const punch of punches) if (mapped.has(String(punch.externalUserId))) await unlockDoor(config.relayUrl, config.relaySecret, config.unlockSeconds)
      }
      await sendPunches(punches)
      res.writeHead(200, {"Content-Type":"application/json"}); res.end(JSON.stringify({ok:true,accepted:punches.length}))
    } catch (e) { res.writeHead(400, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})) }
  })
})
pushServer.listen(PUSH_PORT, "0.0.0.0", () => console.log(`Local biometric push receiver listening on :${PUSH_PORT}`))

main().catch(e => { console.error(e); process.exit(1) })
