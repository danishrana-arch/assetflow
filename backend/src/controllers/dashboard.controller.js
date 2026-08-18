const prisma = require("../lib/prisma")
const { toDateOnly } = require("../utils/date")

async function getStats(req, res, next) {
  try {
    const { organizationId } = req.user
    const in30Days = new Date()
    in30Days.setDate(in30Days.getDate() + 30)

    const [
      totalEmployees,
      totalAssets,
      assignedAssets,
      availableAssets,
      assetsUnderRepair,
      expiringWarranties,
      pendingRequests,
    ] = await Promise.all([
      prisma.user.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.asset.count({ where: { organizationId } }),
      prisma.asset.count({ where: { organizationId, status: "ASSIGNED" } }),
      prisma.asset.count({ where: { organizationId, status: "AVAILABLE" } }),
      prisma.asset.count({ where: { organizationId, status: "REPAIR" } }),
      prisma.asset.count({ where: { organizationId, warrantyEnd: { lte: in30Days, gte: new Date() } } }),
      prisma.ticket.count({ where: { organizationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    ])

    res.json({
      totalEmployees,
      totalAssets,
      assignedAssets,
      availableAssets,
      assetsUnderRepair,
      expiringWarranties,
      pendingRequests,
    })
  } catch (err) {
    next(err)
  }
}

async function getRecentActivity(req, res, next) {
  try {
    const { organizationId } = req.user

    const events = await prisma.lifecycleEvent.findMany({
      where: { asset: { organizationId } },
      include: { asset: true, actor: true },
      orderBy: { occurredAt: "desc" },
      take: 15,
    })

    res.json(events)
  } catch (err) {
    next(err)
  }
}

async function getLatestAssets(req, res, next) {
  try {
    const { organizationId } = req.user
    const assets = await prisma.asset.findMany({
      where: { organizationId },
      include: { assignedTo: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    })
    res.json(assets)
  } catch (err) {
    next(err)
  }
}

const MAX_RANGE_DAYS = 366

function parseRange(query) {
  const now = new Date()
  const todayUTC = toDateOnly(now)

  let end = query.end ? toDateOnly(query.end) : todayUTC
  let start = query.start ? toDateOnly(query.start) : new Date(todayUTC)
  if (!query.start) start.setUTCDate(start.getUTCDate() - 270) // ~9 months, matches old default

  // end is inclusive through the end of that calendar day.
  end = new Date(end)
  end.setUTCHours(23, 59, 59, 999)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: "start and end must be valid dates" }
  }
  if (end < start) {
    return { error: "end can't be before start" }
  }
  const spanDays = Math.round((end - start) / 86400000) + 1
  if (spanDays > MAX_RANGE_DAYS) {
    return { error: `Range can't exceed ${MAX_RANGE_DAYS} days` }
  }
  return { start, end, spanDays }
}

function bucketKey(date, granularity) {
  if (granularity === "day") return date.toISOString().slice(0, 10)
  if (granularity === "week") {
    const d = new Date(date)
    const day = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() - day) // start of week (Sunday), UTC-safe
    return d.toISOString().slice(0, 10)
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` // month
}

function bucketLabel(key, granularity) {
  const d = new Date(granularity === "month" ? `${key}-01T00:00:00.000Z` : `${key}T00:00:00.000Z`)
  const opts = { timeZone: "UTC" }
  if (granularity === "day") return d.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" })
  if (granularity === "week") return `Wk of ${d.toLocaleDateString(undefined, { ...opts, month: "short", day: "numeric" })}`
  return d.toLocaleDateString(undefined, { ...opts, month: "short", year: "2-digit" })
}

// Real inventory activity for the dashboard bar chart, driven by actual
// lifecycle events instead of synthetic data. Admins/management pick any
// custom "from" / "to" date range; the bucket size (day/week/month) is
// chosen automatically based on how wide that range is so the chart stays
// readable.
async function getInventoryActivitySeries(req, res, next) {
  try {
    const { organizationId } = req.user
    const range = parseRange(req.query)
    if (range.error) return res.status(400).json({ error: range.error })
    const { start, end, spanDays } = range

    const granularity = spanDays <= 45 ? "day" : spanDays <= 180 ? "week" : "month"

    const events = await prisma.lifecycleEvent.findMany({
      where: {
        asset: { organizationId },
        occurredAt: { gte: start, lte: end },
      },
      select: { type: true, occurredAt: true },
    })

    const buckets = new Map()
    // Pre-seed buckets across the full range so empty periods still show.
    const cursor = new Date(start)
    while (cursor <= end) {
      const key = bucketKey(cursor, granularity)
      if (!buckets.has(key)) buckets.set(key, { assigned: 0, available: 0, repair: 0 })
      if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1)
      else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7)
      else cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }

    for (const ev of events) {
      const key = bucketKey(ev.occurredAt, granularity)
      if (!buckets.has(key)) buckets.set(key, { assigned: 0, available: 0, repair: 0 })
      const bucket = buckets.get(key)
      if (ev.type === "ASSIGNED") bucket.assigned += 1
      else if (ev.type === "RETURNED" || ev.type === "UNASSIGNED") bucket.available += 1
      else if (ev.type === "REPAIR_STARTED") bucket.repair += 1
    }

    const series = Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, counts]) => ({ key, name: bucketLabel(key, granularity), ...counts }))

    res.json({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), granularity, series })
  } catch (err) {
    next(err)
  }
}

// Total repair spend broken down two ways: per asset (to flag which
// specific items are costing more to maintain than they're worth) and
// per category (to spot systemic problem categories). Only counts
// lifecycle events that actually recorded a cost.
async function getRepairSpend(req, res, next) {
  try {
    const { organizationId } = req.user

    const events = await prisma.lifecycleEvent.findMany({
      where: {
        cost: { not: null },
        type: { in: ["REPAIR_STARTED", "REPAIR_COMPLETED"] },
        asset: { organizationId },
      },
      select: { cost: true, asset: { select: { id: true, name: true, category: true, serialNumber: true } } },
    })

    const byAsset = new Map()
    const byCategory = new Map()
    let total = 0

    for (const ev of events) {
      const cost = Number(ev.cost)
      total += cost

      const assetKey = ev.asset.id
      const existingAsset = byAsset.get(assetKey) || { assetId: assetKey, name: ev.asset.name, serialNumber: ev.asset.serialNumber, total: 0, count: 0 }
      existingAsset.total += cost
      existingAsset.count += 1
      byAsset.set(assetKey, existingAsset)

      const categoryKey = ev.asset.category || "Uncategorized"
      const existingCategory = byCategory.get(categoryKey) || { category: categoryKey, total: 0, count: 0 }
      existingCategory.total += cost
      existingCategory.count += 1
      byCategory.set(categoryKey, existingCategory)
    }

    res.json({
      total,
      byAsset: Array.from(byAsset.values()).sort((a, b) => b.total - a.total).slice(0, 10),
      byCategory: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
    })
  } catch (err) {
    next(err)
  }
}

module.exports = { getStats, getRecentActivity, getLatestAssets, getInventoryActivitySeries, getRepairSpend }
