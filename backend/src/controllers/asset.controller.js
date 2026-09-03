const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { parseCsv } = require("../utils/csv")

async function listAssets(req, res, next) {
  try {
    const { organizationId } = req.user
    const { q, status, departmentId, category, page, pageSize } = req.query

    const where = {
      organizationId,
      ...(status ? { status } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(category ? { category } : {}),
    }

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

      const [total, assets] = await Promise.all([
        prisma.asset.count({ where }),
        prisma.asset.findMany({
          where,
          include: {
            assignedTo: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
            department: true,
          },
          orderBy: { updatedAt: "desc" },
          skip: (pageNum - 1) * size,
          take: size,
        }),
      ])

      return res.json({
        data: assets,
        page: pageNum,
        pageSize: size,
        total,
        totalPages: Math.max(1, Math.ceil(total / size)),
      })
    }

    const assets = await prisma.asset.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
        department: true,
      },
      orderBy: { updatedAt: "desc" },
    })

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
        assignedTo: { select: { id: true, name: true, email: true, role: true, department: { select: { name: true } } } },
        department: true,
        tickets: { orderBy: { createdAt: "desc" } },
        lifecycleEvents: {
          orderBy: { occurredAt: "asc" },
          include: { actor: { select: { id: true, name: true, email: true, role: true } } },
        },
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
const CANONICAL_CATEGORIES = ["Laptop", "Desktop", "Monitor", "Accessories", "Stationery", "Phone", "Other"]

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

// Bulk-create assets from an uploaded .csv sheet (management only).
// Expected header row (any order, case-insensitive): name, category,
// serialNumber, cpu, ram, storage, purchaseDate, warrantyEnd, department.
// New assets always start life as AVAILABLE, same as adding one by hand.
async function importAssets(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: "Upload a .csv file under the 'file' field" })

    const { organizationId, userId } = req.user
    const text = req.file.buffer.toString("utf8")
    const rows = parseCsv(text)
    if (rows.length < 2) {
      return res.status(400).json({ error: "The file needs a header row plus at least one data row" })
    }

    const headerMap = {} // column key -> 0-based index
    rows[0].forEach((cell, idx) => {
      const key = String(cell || "").trim().toLowerCase().replace(/\s+/g, "")
      const match = IMPORT_COLUMNS.find((c) => c.toLowerCase() === key)
      if (match) headerMap[match] = idx
    })
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
              create: { type: "PURCHASED", actorId: userId, note: "Added via bulk CSV import" },
            },
          },
        })
        created.push({ row: rowNum, name: asset.name, serialNumber: asset.serialNumber })
      } catch (err) {
        skipped.push({ row: rowNum, reason: "Could not create row (check for duplicate/invalid data)" })
      }
    }

    logAudit({ organizationId, actorId: userId, action: "asset.bulk_imported", note: `${created.length} asset(s) via CSV` })
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
async function deleteAsset(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const asset = await prisma.asset.findFirst({ where: { id, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })

    if (asset.status === "ASSIGNED") {
      return res.status(400).json({ error: "Unassign this asset before deleting it" })
    }

    await prisma.$transaction([
      prisma.lifecycleEvent.deleteMany({ where: { assetId: id } }),
      prisma.ticket.updateMany({ where: { assetId: id }, data: { assetId: null } }),
      prisma.asset.delete({ where: { id } }),
    ])

    logAudit({ organizationId, actorId: userId, action: "asset.deleted", targetType: "Asset", targetId: id, note: `${asset.name} <${asset.serialNumber}>` })
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
  listAssets,
  listCategories,
  getAsset,
  createAsset,
  assignAsset,
  unassignAsset,
  changeAssetStatus,
  addLifecycleNote,
  importAssets,
  importAssetsTemplate,
  deleteAsset,
  deleteCategory,
}
