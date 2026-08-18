const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")
const { logAudit } = require("../utils/audit")

// Employee asks for something ("I need a monitor"). Doesn't hand over an
// asset by itself — that happens separately via fulfillRequest, once
// management picks a real asset to assign.
async function createRequest(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { category, reason } = req.body

    if (!category || !category.trim()) {
      return res.status(400).json({ error: "category is required" })
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "reason is required" })
    }

    const request = await prisma.assetRequest.create({
      data: {
        organizationId,
        employeeId: userId,
        category: category.trim(),
        reason: reason.trim().slice(0, 1000),
      },
    })

    res.status(201).json(request)
  } catch (err) {
    next(err)
  }
}

// Employees see only their own requests; management sees the whole org
// (optionally filtered by status).
async function listRequests(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { status } = req.query
    const isManagement = MANAGEMENT_ROLES.includes(role)

    const requests = await prisma.assetRequest.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
        ...(isManagement ? {} : { employeeId: userId }),
      },
      include: {
        employee: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
        reviewedBy: { select: { id: true, name: true } },
        fulfilledAsset: { select: { id: true, name: true, serialNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    })

    res.json(requests)
  } catch (err) {
    next(err)
  }
}

// Management approves or rejects. Approving does NOT assign an asset yet —
// that's a separate, explicit fulfillRequest step so management can pick
// exactly which available asset to hand over.
async function reviewRequest(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { decision, reviewNote } = req.body

    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ error: "decision must be APPROVED or REJECTED" })
    }

    const request = await prisma.assetRequest.findFirst({ where: { id, organizationId } })
    if (!request) return res.status(404).json({ error: "Asset request not found" })
    if (request.status !== "PENDING") {
      return res.status(400).json({ error: `This request is already ${request.status.toLowerCase()}` })
    }

    const updated = await prisma.assetRequest.update({
      where: { id },
      data: {
        status: decision,
        reviewedById: userId,
        reviewedAt: new Date(),
        reviewNote: reviewNote ? String(reviewNote).slice(0, 1000) : null,
      },
    })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// Hands over a specific available asset against an APPROVED request —
// assigns it (same effect as the normal assign flow, including the
// lifecycle event) and marks the request FULFILLED.
async function fulfillRequest(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params
    const { assetId } = req.body

    if (!assetId) return res.status(400).json({ error: "assetId is required" })

    const request = await prisma.assetRequest.findFirst({ where: { id, organizationId } })
    if (!request) return res.status(404).json({ error: "Asset request not found" })
    if (request.status !== "APPROVED") {
      return res.status(400).json({ error: "Only an approved request can be fulfilled" })
    }

    const asset = await prisma.asset.findFirst({ where: { id: assetId, organizationId } })
    if (!asset) return res.status(404).json({ error: "Asset not found" })
    if (asset.status !== "AVAILABLE") {
      return res.status(400).json({ error: "That asset isn't available" })
    }

    const employee = await prisma.user.findUnique({ where: { id: request.employeeId } })

    const [, , updatedRequest] = await prisma.$transaction([
      prisma.asset.update({
        where: { id: assetId },
        data: {
          status: "ASSIGNED",
          assignedToId: request.employeeId,
          lifecycleEvents: { create: { type: "ASSIGNED", actorId: userId, note: `Fulfilled request — assigned to ${employee?.name || "employee"}` } },
        },
      }),
      prisma.assetRequest.update({ where: { id }, data: { status: "FULFILLED", fulfilledAssetId: assetId } }),
      prisma.assetRequest.findUnique({ where: { id }, include: { fulfilledAsset: true } }),
    ])

    logAudit({ organizationId, actorId: userId, action: "asset_request.fulfilled", targetType: "AssetRequest", targetId: id, note: `${asset.name} -> ${employee?.name || request.employeeId}` })
    res.json(updatedRequest)
  } catch (err) {
    next(err)
  }
}

// Employee cancels their own still-pending request.
async function cancelRequest(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { id } = req.params

    const request = await prisma.assetRequest.findFirst({ where: { id, organizationId } })
    if (!request) return res.status(404).json({ error: "Asset request not found" })
    if (request.employeeId !== userId) {
      return res.status(403).json({ error: "You can only cancel your own requests" })
    }
    if (request.status !== "PENDING") {
      return res.status(400).json({ error: "Only pending requests can be cancelled" })
    }

    await prisma.assetRequest.delete({ where: { id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { createRequest, listRequests, reviewRequest, fulfillRequest, cancelRequest }
