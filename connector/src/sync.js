const logger = require("./logger")
const state = require("./state")
const { unlockDoor } = require("./door")

function toMillis(v) {
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

// Keeps only punches strictly newer than the device's stored watermark, so a
// re-run of the same 30-minute cycle never re-sends attendance the backend
// already has. New punches are merged in on top of the old (already synced)
// history — nothing already-known is ever re-fetched or re-uploaded.
function filterNewPunches(punches, watermarkIso) {
  const watermarkMs = watermarkIso ? toMillis(watermarkIso) : null
  const withMs = punches
    .map((p) => ({ ...p, _ms: toMillis(p.occurredAt) }))
    .filter((p) => p._ms !== null)

  const fresh = watermarkMs === null ? withMs : withMs.filter((p) => p._ms > watermarkMs)
  fresh.sort((a, b) => a._ms - b._ms)
  return fresh.map(({ _ms, ...p }) => p)
}

async function runDoorUnlockIfMapped(config, punches) {
  if (!config.doorEnabled || !config.relayUrl) return
  const mapped = new Set((config.mappings || []).map((m) => String(m.externalUserId)))
  for (const punch of punches) {
    if (mapped.has(String(punch.externalUserId))) {
      await unlockDoor(config.relayUrl, config.relaySecret, config.unlockSeconds)
    }
  }
}

// One full sync cycle for a device: pull -> keep only new -> unlock door for
// mapped punches -> push new punches to AssetFlow -> advance the watermark.
// Returns how many punches were actually sent (0 is a normal, healthy result
// when nothing new happened on the device since the last cycle).
async function syncOnce({ config, adapter, client }) {
  const watermark = state.getWatermark(config.id)
  const allPunches = await adapter.pullPunches(watermark)
  const newPunches = filterNewPunches(allPunches, watermark)

  logger.info("Sync cycle", {
    device: config.name,
    seenOnDevice: allPunches.length,
    new: newPunches.length,
    watermark: watermark || "(none — first sync)",
  })

  if (!newPunches.length) {
    state.recordSync(config.id, { newestOccurredAt: watermark, sentCount: 0 })
    return 0
  }

  await runDoorUnlockIfMapped(config, newPunches)
  await client.post("/connector/punches", { punches: newPunches })

  const newestOccurredAt = new Date(
    Math.max(...newPunches.map((p) => new Date(p.occurredAt).getTime()))
  ).toISOString()
  state.recordSync(config.id, { newestOccurredAt, sentCount: newPunches.length })
  logger.info(`Sent ${newPunches.length} new punch(es)`, { device: config.name, watermark: newestOccurredAt })
  return newPunches.length
}

module.exports = { syncOnce, filterNewPunches }
