const prisma = require("../lib/prisma")
const { hasModuleAccess } = require("../utils/roles")

// Shared by both the per-employee route (Employee360.jsx) and the org-wide
// route (Performance.jsx, which posts { employeeId, ... } in the body
// instead of putting it in the URL).
async function createReview({ organizationId, reviewerId, employeeId, body }) {
  const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true, name: true } })
  if (!employee) return { status: 404, error: "Employee not found" }
  const { periodStart, periodEnd, rating, goals, achievements, feedback } = body
  const score = Number(rating)
  if (!Number.isFinite(score) || score < 1 || score > 5) return { status: 400, error: "Rating must be between 1 and 5" }
  if (!periodStart || !periodEnd) return { status: 400, error: "Review period is required" }
  const start = new Date(periodStart); const end = new Date(periodEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return { status: 400, error: "Invalid review period" }
  const review = await prisma.performanceReview.create({
    data: { organizationId, employeeId, reviewerId, periodStart: start, periodEnd: end, rating: score, goals: goals?.trim() || null, achievements: achievements?.trim() || null, feedback: feedback?.trim() || null },
    include: { reviewer: { select: { id: true, name: true, role: true } } },
  })
  await prisma.notification.create({ data: { organizationId, recipientId: employeeId, createdById: reviewerId, type: "PERFORMANCE", title: "Performance review published", message: `A performance review for ${review.periodStart.toISOString().slice(0,10)} to ${review.periodEnd.toISOString().slice(0,10)} is available.`, link: `/employee-360/${employeeId}` } }).catch(() => {})
  return { status: 201, review }
}

async function listPerformanceReviews(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const employeeId = req.params.employeeId
    if (!hasModuleAccess(role, "performance") && employeeId !== userId) return res.status(403).json({ error: "You can only view your own performance history" })
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
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can create performance reviews" })
    const result = await createReview({ organizationId, reviewerId: userId, employeeId: req.params.employeeId, body: req.body })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(result.review)
  } catch (err) { next(err) }
}

// Org-wide list backing Performance.jsx: management sees every review in
// the organization, anyone else sees only their own (mirrors the
// per-employee route's self-view rule above, just without requiring an
// employeeId in the URL).
async function listAllPerformanceReviews(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const management = hasModuleAccess(role, "performance")
    const reviews = await prisma.performanceReview.findMany({
      where: { organizationId, ...(management ? {} : { employeeId: userId }) },
      include: {
        reviewer: { select: { id: true, name: true, role: true } },
        employee: { select: { id: true, name: true, department: { select: { name: true } } } },
      },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    })
    res.json(reviews)
  } catch (err) { next(err) }
}

// Org-wide create backing Performance.jsx's employee picker — same rules
// as the per-employee route, just reading employeeId from the body.
async function createPerformanceReviewForEmployee(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can create performance reviews" })
    const employeeId = req.body.employeeId
    if (!employeeId) return res.status(400).json({ error: "Employee is required" })
    const result = await createReview({ organizationId, reviewerId: userId, employeeId, body: req.body })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(result.review)
  } catch (err) { next(err) }
}

async function updatePerformanceReview(req, res, next) {
  try {
    const { organizationId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can edit performance reviews" })
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, organizationId } })
    if (!review) return res.status(404).json({ error: "Review not found" })

    const { periodStart, periodEnd, rating, goals, achievements, feedback } = req.body
    const data = {}
    if (rating !== undefined) {
      const score = Number(rating)
      if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: "Rating must be between 1 and 5" })
      data.rating = score
    }
    if (periodStart !== undefined || periodEnd !== undefined) {
      const start = new Date(periodStart ?? review.periodStart)
      const end = new Date(periodEnd ?? review.periodEnd)
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return res.status(400).json({ error: "Invalid review period" })
      data.periodStart = start
      data.periodEnd = end
    }
    if (goals !== undefined) data.goals = goals?.trim() || null
    if (achievements !== undefined) data.achievements = achievements?.trim() || null
    if (feedback !== undefined) data.feedback = feedback?.trim() || null

    const updated = await prisma.performanceReview.update({
      where: { id: review.id },
      data,
      include: {
        reviewer: { select: { id: true, name: true, role: true } },
        employee: { select: { id: true, name: true, department: { select: { name: true } } } },
      },
    })
    res.json(updated)
  } catch (err) { next(err) }
}

async function deletePerformanceReview(req, res, next) {
  try {
    const { organizationId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can delete performance reviews" })
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, organizationId } })
    if (!review) return res.status(404).json({ error: "Review not found" })
    await prisma.performanceReview.delete({ where: { id: review.id } })
    res.status(204).send()
  } catch (err) { next(err) }
}

module.exports = {
  listPerformanceReviews,
  createPerformanceReview,
  listAllPerformanceReviews,
  createPerformanceReviewForEmployee,
  updatePerformanceReview,
  deletePerformanceReview,
}
