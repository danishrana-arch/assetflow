const prisma = require("../lib/prisma")
const { MANAGEMENT_ROLES } = require("../utils/roles")

async function listTickets(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { status, priority, category } = req.query

    const tickets = await prisma.ticket.findMany({
      where: {
        organizationId,
        ...(!MANAGEMENT_ROLES.includes(role) ? { raisedById: userId } : {}),
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(category ? { category } : {}),
      },
      include: { raisedBy: true, asset: true },
      orderBy: { createdAt: "desc" },
    })

    res.json(tickets)
  } catch (err) {
    next(err)
  }
}

async function createTicket(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const { subject, description, priority, category, assetId, imageUrl } = req.body

    if (!subject || !description) {
      return res.status(400).json({ error: "subject and description are required" })
    }

    const ticket = await prisma.ticket.create({
      data: {
        organizationId,
        subject,
        description,
        priority: priority || "MEDIUM",
        category: category || null,
        assetId: assetId || null,
        imageUrl: imageUrl || null,
        raisedById: userId,
      },
    })

    res.status(201).json(ticket)
  } catch (err) {
    next(err)
  }
}

async function updateTicketStatus(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params
    const { status } = req.body

    const validStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${validStatuses.join(", ")}` })
    }

    const existing = await prisma.ticket.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Ticket not found" })

    const updated = await prisma.ticket.update({ where: { id }, data: { status } })
    res.json(updated)
  } catch (err) {
    next(err)
  }
}

async function deleteTicket(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params

    const existing = await prisma.ticket.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Ticket not found" })

    await prisma.ticket.delete({ where: { id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { listTickets, createTicket, updateTicketStatus, deleteTicket }
