require("dotenv").config()

function num(name, fallback) {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const API = (process.env.ASSETFLOW_API_URL || "http://localhost:4000/api/biometric").replace(/\/$/, "")
const TOKEN = process.env.CONNECTOR_TOKEN

// Default sync cadence is 30 minutes. A device may be polled more often for
// heartbeat/online-status purposes, but a full attendance sync only runs on
// this cadence unless overridden.
const POLL_INTERVAL_MS = num("POLL_INTERVAL_MS", 30 * 60 * 1000)
const HEARTBEAT_INTERVAL_MS = num("HEARTBEAT_INTERVAL_MS", Math.max(60000, Math.floor(POLL_INTERVAL_MS / 3)))

const RETRY_BASE_MS = num("RETRY_BASE_MS", 5000)
const RETRY_MAX_MS = num("RETRY_MAX_MS", 5 * 60 * 1000)
const RETRY_MAX_ATTEMPTS = num("RETRY_MAX_ATTEMPTS", 6)

// A device with no watermark yet (first-ever sync, or a long offline gap)
// can hand back thousands of punches in one pull. Pushing them to the
// backend in one request risks the client timeout below on a big backfill,
// so sync.js sends them in batches of this size instead, persisting the
// watermark after each batch so a failure partway through doesn't require
// re-sending batches that already landed.
const PUNCH_BATCH_SIZE = num("PUNCH_BATCH_SIZE", 300)

const STATE_FILE = process.env.STATE_FILE || require("path").join(__dirname, "..", ".sync-state.json")
const PUSH_PORT = num("LOCAL_PUSH_PORT", 8787)

if (!TOKEN) {
  // eslint-disable-next-line no-console
  console.error("CONNECTOR_TOKEN is required — copy it from Settings > Attendance Devices in AssetFlow.")
  process.exit(1)
}

module.exports = {
  API,
  TOKEN,
  POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  RETRY_MAX_ATTEMPTS,
  PUNCH_BATCH_SIZE,
  STATE_FILE,
  PUSH_PORT,
}
