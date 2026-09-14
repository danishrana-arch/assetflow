const prisma = require("../lib/prisma")
const { isManagement } = require("../utils/roles")

async function listPerformanceReviews(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const employeeId = req.params.employeeId
    if (!isManagement(role) && employeeId !== userId) return res.status(403).json({ error: "You can only view your own performance history" })
    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const reviews = await prisma.performanceReview.findMany({
      where: { organizationId, employeeId },
      include: { reviewer: { select: { id: true, name: true, role: true } } },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    })
    res.json(reviews)
  } catch (err) { next(err) }
}

async function createPerformanceReview(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!isManagement(role)) return res.status(403).json({ error: "Only management can create performance reviews" })
    const employeeId = req.params.employeeId
    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true, name: true } })
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const { periodStart, periodEnd, rating, goals, achievements, feedback } = req.body
    const score = Number(rating)
    if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: "Rating must be between 1 and 5" })
    if (!periodStart || !periodEnd) return res.status(400).json({ error: "Review period is required" })
    const start = new Date(periodStart); const end = new Date(periodEnd)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return res.status(400).json({ error: "Invalid review period" })
    const review = await prisma.performanceReview.create({
      data: { organizationId, employeeId, reviewerId: userId, periodStart: start, periodEnd: end, rating: score, goals: goals?.trim() || null, achievements: achievements?.trim() || null, feedback: feedback?.trim() || null },
      include: { reviewer: { select: { id: true, name: true, role: true } } },
    })
    await prisma.notification.create({ data: { organizationId, recipientId: employeeId, createdById: userId, type: "PERFORMANCE", title: "Performance review published", message: `A performance review for ${review.periodStart.toISOString().slice(0,10)} to ${review.periodEnd.toISOString().slice(0,10)} is available.`, link: `/employee-360/${employeeId}` } }).catch(() => {})
    res.status(201).json(review)
  } catch (err) { next(err) }
}

module.exports = { listPerformanceReviews, createPerformanceReview }
