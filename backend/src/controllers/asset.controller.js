const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { sortRows } = require("../utils/sort")
const { readSheet, mapHeaders, SheetError, ACCEPTED_LABEL } = require("../utils/sheet")
const { createNotification } = require("../utils/notifications")

const ASSET_STATUSES = ["ASSIGNED", "AVAILABLE", "REPAIR", "LOST", "DISPOSED"]

// List views only need who holds the asset — never the holder's password
// hash or encrypted PII (the old `assignedTo: true` sent the whole User row).
const ASSET_LIST_INCLUDE = {
  assignedTo: {
    select: { id: true, name: true, email: true, role: true, designation: true, photoUrl: true, department: { select: { name: true } } },
  },
  department: true,
}

// Inventory page header: status totals, this-month growth, a 6-month total
// trend, and the latest lifecycle activity across the org's assets.
async function getInventorySummary(req, res, next) {
  try {
    const { organizationId } = req.user
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const activityLimit = Math.min(50, Math.max(1, parseInt(req.query.activity, 10) || 6))

    const [byStatus, addedThisMonth, beforeTrend, created, activity] = await Promise.all([
      prisma.asset.groupBy({ by: ["status"], where: { organizationId }, _count: { _all: true } }),
      prisma.asset.count({ where: { organizationId, createdAt: { gte: monthStart } } }),
      prisma.asset.count({ where: { organizationId, createdAt: { lt: trendStart } } }),
      prisma.asset.findMany({ where: { organizationId, createdAt: { gte: trendStart } }, select: { createdAt: true } }),
      prisma.lifecycleEvent.findMany({
        where: { asset: { organizationId } },
        orderBy: { occurredAt: "desc" },
        take: activityLimit,
        include: {
          asset: { select: { id: true, name: true, category: true } },
          actor: { select: { id: true, name: true } },
        },
      }),
    ])

    const statusCounts = Object.fromEntries(ASSET_STATUSES.map((s) => [s, 0]))
    for (const g of byStatus) statusCounts[g.status] = g._count._all
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)

    // Cumulative asset count at the end of each of the last 6 months
    // (deleted assets aren't tracked, so this is "assets that still exist").
    const trend = []
    let running = beforeTrend
    for (let i = 0; i < 6; i++) {
      const start = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
      const end = new Date(now.getFullYear(), now.getMonth() - 4 + i, 1)
      running += created.filter((a) => a.createdAt >= start && a.createdAt < end).length
      trend.push({ month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`, total: running })
    }

    res.json({
      total,
      statusCounts,
      addedThisMonth,
      totalLastMonth: total - addedThisMonth,
      trend,
      activity: activity.map((e) => ({
        id: e.id,
        type: e.type,
        note: e.note,
        occurredAt: e.occurredAt,
        asset: e.asset,
        actor: e.actor,
      })),
    })
  } catch (err) {
    next(err)
  }
}

async function listAssets(req, res, next) {
  try {
    const { organizationId } = req.user
    const { q, status, departmentId, category, warranty, page, pageSize } = req.query

    // status may be one value or a comma list (e.g. "LOST,DISPOSED").
    const statuses = String(status || "").split(",").filter((s) => ASSET_STATUSES.includes(s))
    const where = {
      organizationId,
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(category ? { category } : {}),
    }

    // Same window as the dashboard's "Warranty Alerts" count (getStats).
    if (warranty === "expiring") {
      const in30Days = new Date()
      in30Days.setDate(in30Days.getDate() + 30)
      where.warrantyEnd = { gte: new Date(), lte: in30Days }
    } else if (warranty === "expired") {
      where.warrantyEnd = { lt: new Date() }
    }

    // Column sorts are case-insensitive, done in JS (utils/sort.js); the
    // default (most recently updated first) stays a DB sort.
    const order = req.query.order === "asc" ? "asc" : "desc"
    const SORT_VALUES = {
      serialNumber: (a) => a.serialNumber,
      name: (a) => a.name,
      category: (a) => a.category,
      assignedTo: (a) => a.assignedTo?.name,
      status: (a) => a.status,
      purchaseDate: (a) => a.purchaseDate?.getTime(),
    }
    const sortValue = SORT_VALUES[req.query.sort]
    const orderBy = { updatedAt: "desc" }

    if (q) {
      const query = q.trim().toLowerCase()

      if (query === "expired warranty") {
        where.warrantyEnd = { lt: new Date() }
      } else {
        where.OR = [
          { name: { contains: q, mode: "insensitive" } },
          { category: { contains: q, mode: "insensitive" } },
          { serialNumber: { contains: q, mode: "insensitive" } },
          { cpu: { contains: q, mode: "insensitive" } },
          { ram: { contains: q, mode: "insensitive" } },
          { storage: { contains: q, mode: "insensitive" } },
          { assignedTo: { name: { contains: q, mode: "insensitive" } } },
        ]
      }
    }

    // Opt-in pagination, same convention as GET /employees — omit `page`
    // to keep getting the old plain-array response (used by dropdowns).
    if (page) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 25))

      let total, assets
      if (sortValue) {
        const rows = await prisma.asset.findMany({ where, orderBy, include: ASSET_LIST_INCLUDE })
        total = rows.length
        assets = sortRows(rows, sortValue, order, (a) => a.name).slice((pageNum - 1) * size, pageNum * size)
      } else {
        ;[total, assets] = await Promise.all([
          prisma.asset.count({ where }),
          prisma.asset.findMany({
            where,
            include: ASSET_LIST_INCLUDE,
            orderBy,
            skip: (pageNum - 1) * size,
            take: size,
          }),
        ])
      }

      return res.json({
        data: assets,
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
      })
    }

    let assets = await prisma.asset.findMany({ where, include: ASSET_LIST_INCLUDE, orderBy })
    if (sortValue) assets = sortRows(assets, sortValue, order, (a) => a.name)

    res.json(assets)
  } catch (err) {
    next(err)
  }
}

async function getAsset(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params

    const asset = await prisma.asset.findFirst({
      where: { id, organizationId },
      include: {
        assignedTo: ASSET_LIST_INCLUDE.assignedTo,
        department: true,
        tickets: { orderBy: { createdAt: "desc" } },
        lifecycleEvents: { orderBy: { occurredAt: "asc" }, include: { actor: { select: { id: true, name: true } } } },
      },
    })

    if (!asset) return res.status(404).json({ error: "Asset not found" })
    res.json(asset)
  } catch (err) {
    next(err)
  }
}

// Canonical starter categories always offered in the filter/Add-Asset
// dropdown, plus any custom category values already in use in this org
// (so a category someone typed before this list existed still shows up).
const CANONICAL_CATEGORIES = ["Laptop", "Desktop", "Monitor", "Accessories", "Stationery", "Phone"]

async function listCategories(req, res, next) {
  try {
    const { organizationId } = req.user
    const grouped = await prisma.asset.groupBy({
      by: ["category"],
      where: { organizationId, category: { not: null } },
      _count: { category: true },
    })
    const counts = new Map(grouped.map((g) => [g.category, g._count.category]))
    // Canonical categories always show up (even at 0) so the filter row
    // stays stable; anything custom the org has actually used gets added too.
    const names = Array.from(new Set([...CANONICAL_CATEGORIES, ...counts.keys()]))
    const withCounts = names.map((name) => ({ name, count: counts.get(name) || 0 }))
    res.json(withCounts)
  } catch (err) {
    next(err)
  }
}

async function createAsset(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { name, category, serialNumber, cpu, ram, storage, purchaseDate, warrantyEnd, departmentId } = req.body

    if (!name || !serialNumber) {
      return res.status(400).json({ error: "name and serialNumber are required" })
    }

    const asset = await prisma.asset.create({
      data: {
        organizationId,
        name,
        category,
        serialNumber,
        cpu,
        ram,
        storage,
        purchaseDate: purchaseDate ? new Date(purchaseDate) : null,
        warrantyEnd: warrantyEnd ? new Date(warrantyEnd) : null,
        departmentId: departmentId || null,
        status: "AVAILABLE",
        lifecycleEvents: {
          create: { type: "PURCHASED", actorId: userId, note: "Asset added to inventory" },
        },
      },
    })

    res.status(201).json(asset)
  } catch (err) {
    next(err)
  }
}

const EDITABLE_FIELDS = ["name", "category", "serialNumber", "cpu", "ram", "storage", "purchaseDate", "warrantyEnd", "departmentId"]

// PATCH /assets/:id — edit an asset's details. Assignment and status have
// their own actions (assign/unassign/status) so their lifecycle history
// stays intact; this only changes the descriptive fields.
async function updateAsset(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const asset = await prisma.asset.findFirst({ where: { id, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    const data = {}
    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] === undefined) continue
      const raw = req.body[key]
      const value = typeof raw === "string" ? raw.trim() : raw
      if (key === "purchaseDate" || key === "warrantyEnd") {
        if (!value) { data[key] = null; continue }
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return res.status(400).json({ error: `${key} must be a valid date` })
        data[key] = date
      } else {
        data[key] = value || null
      }
    }
    if ("name" in data && !data.name) return res.status(400).json({ error: "Name is required" })
    if ("serialNumber" in data && !data.serialNumber) return res.status(400).json({ error: "Serial number is required" })
    if (data.departmentId) {
      const department = await prisma.department.findFirst({ where: { id: data.departmentId, organizationId }, select: { id: true } })
      if (!department) return res.status(400).json({ error: "Department not found" })
    }
    if (data.serialNumber && data.serialNumber !== asset.serialNumber) {
      const clash = await prisma.asset.findUnique({ where: { serialNumber: data.serialNumber }, select: { id: true } })
      if (clash) return res.status(409).json({ error: "Another asset already has this serial number" })
    }

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        ...data,
        lifecycleEvents: { create: { type: "NOTE", actorId: userId, note: "Asset details updated" } },
      },
      include: { assignedTo: { select: { id: true, name: true } }, department: true },
    })
    logAudit({ organizationId, actorId: userId, action: "asset.updated", targetType: "Asset", targetId: id, note: `${updated.name} <${updated.serialNumber}>` })
    res.json(updated)
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "Another asset already has this serial number" })
    next(err)
  }
}

async function assignAsset(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { employeeId, note } = req.body

    if (!employeeId) return res.status(400).json({ error: "employeeId is required" })

    const asset = await prisma.asset.findFirst({ where: { id, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        assignedToId: employeeId,
        status: "ASSIGNED",
        lifecycleEvents: {
          create: { type: "ASSIGNED", actorId: userId, note: note || `Assigned to ${employee.name}` },
        },
      },
    })

    logAudit({ organizationId, actorId: userId, action: "asset.assigned", targetType: "Asset", targetId: id, note: `to ${employee.name}` })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// Dedicated unassign action — the counterpart to assignAsset. Anything
// that has been assigned to an employee can be taken back by management,
// which frees it up as AVAILABLE again and logs who did it and when.
async function unassignAsset(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { note } = req.body

    const asset = await prisma.asset.findFirst({ where: { id, organizationId }, include: { assignedTo: true } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })
    if (!asset.assignedToId) return res.status(400).json({ error: "This asset isn't assigned to anyone" })

    const previousHolder = asset.assignedTo?.name

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        assignedToId: null,
        status: "AVAILABLE",
        lifecycleEvents: {
          create: { type: "RETURNED", actorId: userId, note: note || (previousHolder ? `Unassigned from ${previousHolder}` : "Unassigned") },
        },
      },
    })

    logAudit({ organizationId, actorId: userId, action: "asset.unassigned", targetType: "Asset", targetId: id, note: previousHolder ? `from ${previousHolder}` : undefined })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

async function changeAssetStatus(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { status, note, eventType, cost } = req.body

    const validStatuses = ["ASSIGNED", "AVAILABLE", "REPAIR", "LOST", "DISPOSED"]
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${validStatuses.join(", ")}` })
    }

    const asset = await prisma.asset.findFirst({ where: { id, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    let costValue
    if (cost !== undefined && cost !== null && cost !== "") {
      const parsed = Number(cost)
      if (Number.isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ error: "cost must be a positive number" })
      }
      costValue = parsed
    }

    const clearsAssignment = ["AVAILABLE", "LOST", "DISPOSED"].includes(status)

    const updated = await prisma.asset.update({
      where: { id },
      data: {
        status,
        ...(clearsAssignment ? { assignedToId: null } : {}),
        lifecycleEvents: {
          create: { type: eventType || "NOTE", actorId: userId, note: note || undefined, cost: costValue },
        },
      },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

async function addLifecycleNote(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { type, note, cost } = req.body

    const asset = await prisma.asset.findFirst({ where: { id, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    let costValue
    if (cost !== undefined && cost !== null && cost !== "") {
      const parsed = Number(cost)
      if (Number.isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ error: "cost must be a positive number" })
      }
      costValue = parsed
    }

    const event = await prisma.lifecycleEvent.create({
      data: { assetId: id, type: type || "NOTE", note, cost: costValue, actorId: userId },
    })

    res.status(201).json(event)
  } catch (err) {
    next(err)
  }
}

const IMPORT_COLUMNS = ["name", "category", "serialNumber", "cpu", "ram", "storage", "purchaseDate", "warrantyEnd", "department"]
const ASSET_IMPORT_ALIASES = {
  name: ["asset name", "asset", "item", "item name", "product", "device"],
  category: ["type", "asset type", "item type", "group"],
  serialNumber: ["serial", "serial no", "serial #", "s/n", "sn", "asset id", "asset tag", "tag", "imei", "service tag"],
  cpu: ["processor", "cpu model"],
  ram: ["memory", "ram size"],
  storage: ["disk", "hdd", "ssd", "storage size", "hard drive"],
  purchaseDate: ["purchased", "purchased on", "date of purchase", "purchase", "bought on", "acquired"],
  warrantyEnd: ["warranty", "warranty end date", "warranty expiry", "warranty expires", "warranty until"],
  department: ["dept", "team"],
}

// Bulk-create assets from an uploaded .csv sheet (management only).
// Expected header row (any order, case-insensitive): name, category,
// serialNumber, cpu, ram, storage, purchaseDate, warrantyEnd, department.
// New assets always start life as AVAILABLE, same as adding one by hand.
async function importAssets(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: `Upload a spreadsheet (${ACCEPTED_LABEL}) under the 'file' field` })

    const { organizationId, userId } = req.user
    let rows
    try {
      rows = await readSheet(req.file)
    } catch (err) {
      if (err instanceof SheetError) return res.status(400).json({ error: err.message })
      throw err
    }
    if (rows.length < 2) {
      return res.status(400).json({ error: "The file needs a header row plus at least one data row" })
    }

    const headerMap = mapHeaders(rows[0], IMPORT_COLUMNS, ASSET_IMPORT_ALIASES) // column key -> 0-based index
    if (headerMap.name === undefined || headerMap.serialNumber === undefined) {
      return res.status(400).json({ error: "The sheet must have at least 'name' and 'serialNumber' columns" })
    }

    const departments = await prisma.department.findMany({ where: { organizationId } })
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]))

    const created = []
    const skipped = []

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const rowNum = r + 1 // 1-based, matching what a spreadsheet viewer would show
      const cell = (key) => (headerMap[key] !== undefined ? (row[headerMap[key]] || "").trim() : "")

      const name = cell("name")
      const serialNumber = cell("serialNumber")
      if (!name && !serialNumber) continue // blank row

      if (!name || !serialNumber) {
        skipped.push({ row: rowNum, reason: "Missing name or serialNumber" })
        continue
      }

      const existing = await prisma.asset.findFirst({ where: { organizationId, serialNumber } })
      if (existing) {
        skipped.push({ row: rowNum, reason: `Serial number already exists (${serialNumber})` })
        continue
      }

      const departmentName = cell("department")
      const purchaseDateRaw = cell("purchaseDate")
      const warrantyEndRaw = cell("warrantyEnd")
      const purchaseDate = purchaseDateRaw ? new Date(purchaseDateRaw) : null
      const warrantyEnd = warrantyEndRaw ? new Date(warrantyEndRaw) : null

      try {
        const asset = await prisma.asset.create({
          data: {
            organizationId,
            name,
            category: cell("category") || null,
            serialNumber,
            cpu: cell("cpu") || null,
            ram: cell("ram") || null,
            storage: cell("storage") || null,
            purchaseDate: purchaseDate && !Number.isNaN(purchaseDate.getTime()) ? purchaseDate : null,
            warrantyEnd: warrantyEnd && !Number.isNaN(warrantyEnd.getTime()) ? warrantyEnd : null,
            departmentId: deptByName.get(departmentName.toLowerCase()) || null,
            status: "AVAILABLE",
            lifecycleEvents: {
              create: { type: "PURCHASED", actorId: userId, note: "Added via sheet import" },
            },
          },
        })
        created.push({ row: rowNum, name: asset.name, serialNumber: asset.serialNumber })
      } catch (err) {
        skipped.push({ row: rowNum, reason: "Could not create row (check for duplicate/invalid data)" })
      }
    }

    logAudit({ organizationId, actorId: userId, action: "asset.bulk_imported", note: `${created.length} asset(s) via sheet import (${req.file.originalname || "file"})` })
    res.json({ createdCount: created.length, skippedCount: skipped.length, created, skipped })
  } catch (err) {
    next(err)
  }
}

// A blank starter CSV with the columns importAssets understands.
async function importAssetsTemplate(req, res, next) {
  const header = IMPORT_COLUMNS.join(",")
  const example = [
    "Dell Latitude 7440", "Laptop", "SN-0001", "Intel i7", "16GB", "512GB SSD",
    "2026-01-15", "2028-01-15", "Engineering",
  ].join(",")
  const csv = `${header}\n${example}\n`

  res.setHeader("Content-Type", "text/csv")
  res.setHeader("Content-Disposition", "attachment; filename=asset-import-template.csv")
  res.send(csv)
}

// Deleting an asset also removes its own lifecycle history (nothing else
// needs that history once the asset itself is gone — unlike removing an
// employee, where the ASSET's history has to survive). LifecycleEvent has
// a required link to its asset with no cascade rule, so those rows have to
// be cleared first or the delete fails with a foreign-key error.
//
// An asset that's still assigned can only be deleted by ADMIN/CEO: it's
// unassigned from the employee automatically (they get a notification).
// Other inventory roles still have to unassign it first. A fulfilled asset
// request keeps its record but loses the link to the deleted asset.
async function deleteAsset(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { id } = req.params

    const asset = await prisma.asset.findFirst({ where: { id, organizationId }, include: { assignedTo: { select: { id: true, name: true } } } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    const assigned = asset.status === "ASSIGNED" || !!asset.assignedToId
    if (assigned && !["ADMIN", "CEO"].includes(role)) {
      return res.status(400).json({ error: "Unassign this asset before deleting it (only Admin or CEO can delete an assigned asset)" })
    }

    await prisma.$transaction([
      prisma.lifecycleEvent.deleteMany({ where: { assetId: id } }),
      prisma.ticket.updateMany({ where: { assetId: id }, data: { assetId: null } }),
      prisma.assetRequest.updateMany({ where: { fulfilledAssetId: id }, data: { fulfilledAssetId: null } }),
      prisma.asset.delete({ where: { id } }),
    ])

    const holder = asset.assignedTo
    if (holder) {
      await createNotification({
        organizationId,
        recipientId: holder.id,
        createdById: userId,
        type: "ASSET",
        title: "Asset removed",
        message: `${asset.name} (${asset.serialNumber}) was deleted from inventory and is no longer assigned to you.`,
        link: `/employees/${holder.id}`,
      }).catch(() => {})
    }

    logAudit({ organizationId, actorId: userId, action: "asset.deleted", targetType: "Asset", targetId: id, note: `${asset.name} <${asset.serialNumber}>${holder ? ` — unassigned from ${holder.name}` : ""}` })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

async function deleteCategory(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { name } = req.params

    const categoryName = decodeURIComponent(name || "")
    if (!categoryName) {
      return res.status(400).json({ error: "Category name is required" })
    }

    const updated = await prisma.asset.updateMany({
      where: { organizationId, category: categoryName },
      data: { category: null },
    })

    logAudit({
      organizationId,
      actorId: userId,
      action: "asset.category_removed",
      targetType: "Asset",
      note: `Removed category ${categoryName} from ${updated.count} asset(s)`,
    })

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getInventorySummary,
  listAssets,
  listCategories,
  getAsset,
  createAsset,
  updateAsset,
  assignAsset,
  unassignAsset,
  changeAssetStatus,
  addLifecycleNote,
  importAssets,
  importAssetsTemplate,
  deleteAsset,
  deleteCategory,
}
