const fs = require("fs")
const { STATE_FILE } = require("./config")
const logger = require("./logger")

// Shape on disk:
// { "<deviceId>": { watermark: "<ISO timestamp of newest punch already sent>",
//                    lastSyncAt: "<ISO timestamp of last successful sync>",
//                    totalSynced: <cumulative count> } }
let cache = null

function load() {
  if (cache) return cache
  try {
    cache = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  } catch {
    cache = {}
  }
  return cache
}

function persist() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(cache, null, 2))
  } catch (e) {
    logger.warn("Could not persist sync state to disk", { file: STATE_FILE, error: e.message })
  }
}

function getWatermark(deviceId) {
  const s = load()
  return s[deviceId]?.watermark || null
}

function recordSync(deviceId, { newestOccurredAt, sentCount }) {
  const s = load()
  const prev = s[deviceId] || { totalSynced: 0 }
  s[deviceId] = {
    watermark: newestOccurredAt || prev.watermark || null,
    lastSyncAt: new Date().toISOString(),
    totalSynced: (prev.totalSynced || 0) + (sentCount || 0),
  }
  persist()
}

module.exports = { getWatermark, recordSync }
