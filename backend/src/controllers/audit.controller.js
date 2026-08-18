const prisma = require("../lib/prisma")

async function listAuditLog(req, res, next) {
  try {
    const { organizationId } = req.user
    const { action, limit } = req.query

    const entries = await prisma.auditLog.findMany({
      where: { organizationId, ...(action ? { action: { contains: action, mode: "insensitive" } } : {}) },
      include: { actor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, parseInt(limit, 10) || 100)),
    })

    res.json(entries)
  } catch (err) {
    next(err)
  }
}

module.exports = { listAuditLog }
