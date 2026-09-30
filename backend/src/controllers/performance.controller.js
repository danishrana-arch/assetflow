const prisma = require("../lib/prisma")
const { hasModuleAccess } = require("../utils/roles")
const { toNumber, pickPayrollMonthForClaim, syncPerformanceBonus } = require("../utils/payroll")
const { ensurePayslip } = require("./payroll.controller")

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
// Same floor as a manual payslip bonus (payroll.controller.js MIN_BONUS).
const MIN_BONUS = 500
const MAX_BONUS = 10_000_000

const REVIEW_INCLUDE = {
  reviewer: { select: { id: true, name: true, role: true } },
  employee: { select: { id: true, name: true, department: { select: { name: true } } } },
}

// A bonus is money, so only payroll-module roles (ADMIN/CEO) may set it.
function canAwardBonus(role) {
  return hasModuleAccess(role, "payroll")
}

// Returns { value } (a number, or undefined when not sent) or { error }.
function parseBonus(raw) {
  if (raw === undefined || raw === null || raw === "") return { value: undefined }
  const value = Math.round(Number(raw) * 100) / 100
  if (!Number.isFinite(value) || value < 0) return { error: "Bonus must be a positive amount" }
  if (value > 0 && value < MIN_BONUS) return { error: `Bonus must be at least PKR ${MIN_BONUS} (or 0 for no bonus)` }
  if (value > MAX_BONUS) return { error: "Bonus is too large" }
  return { value }
}

// A review covers one calendar month. The client sends `month: "YYYY-MM"`;
// older callers may still send periodStart/periodEnd, which is accepted as-is.
// Returns { start, end } (UTC dates) or { error }.
function parsePeriod(body, fallback) {
  if (body.month !== undefined) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(body.month || ""))
    const year = match && Number(match[1])
    const month = match && Number(match[2])
    if (!match || month < 1 || month > 12 || year < 2000 || year > 2100) return { error: "Review month is required (YYYY-MM)" }
    return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) }
  }
  const rawStart = body.periodStart ?? fallback?.periodStart
  const rawEnd = body.periodEnd ?? fallback?.periodEnd
  if (!rawStart || !rawEnd) return { error: "Review month is required" }
  const start = new Date(rawStart); const end = new Date(rawEnd)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return { error: "Invalid review period" }
  return { start, end }
}

function sameMonthFilter(start) {
  return { periodStart: { gte: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)), lt: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) } }
}

function monthLabel(month, year) {
  return `${MONTHS[month - 1]} ${year}`
}

// Bonus amounts are only shown to payroll roles and to the employee the
// review is about; other performance reviewers see the review without them.
function present(review, viewer, extra = {}) {
  const visible = canAwardBonus(viewer.role) || review.employeeId === viewer.userId
  const { bonusAmount, bonusPayrollMonth, bonusPayrollYear, ...rest } = review
  if (!visible) return rest
  return { ...rest, bonusAmount: toNumber(bonusAmount), bonusPayrollMonth, bonusPayrollYear, ...extra }
}

// Puts the review's bonus on its payslip right away: creates that month's
// DRAFT payslip if the employee doesn't have one yet, then re-derives the
// payslip's performance bonus and totals. Returns what the UI shows.
async function applyBonusToPayslip({ organizationId, userId, review }) {
  if (!review.bonusPayrollMonth) return null
  const { month, year } = { month: review.bonusPayrollMonth, year: review.bonusPayrollYear }
  const { record, created } = await ensurePayslip({ organizationId, userId, employeeId: review.employeeId, month, year })
  if (!record) return { month, year, label: monthLabel(month, year), status: null, created: false }
  const synced = (await syncPerformanceBonus(prisma, review.employeeId, month, year)) || record
  return { month, year, label: monthLabel(month, year), status: synced.status, created, netPay: toNumber(synced.netPay), performanceBonus: toNumber(synced.performanceBonus) }
}

// Shared by both the per-employee route (/performance/:employeeId) and the org-wide
// route (Performance.jsx, which posts { employeeId, month, ... } in the body
// instead of putting it in the URL).
async function createReview({ organizationId, reviewerId, role, employeeId, body }) {
  const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId }, select: { id: true, name: true } })
  if (!employee) return { status: 404, error: "Employee not found" }
  const { rating, goals, achievements, feedback } = body
  const score = Number(rating)
  if (!Number.isFinite(score) || score < 1 || score > 5) return { status: 400, error: "Rating must be between 1 and 5" }
  const period = parsePeriod(body)
  if (period.error) return { status: 400, error: period.error }
  const bonus = parseBonus(body.bonusAmount)
  if (bonus.error) return { status: 400, error: bonus.error }
  const bonusAmount = bonus.value || 0
  if (bonusAmount > 0 && !canAwardBonus(role)) return { status: 403, error: "Only Admin or CEO can award a performance bonus" }

  const duplicate = await prisma.performanceReview.findFirst({ where: { organizationId, employeeId, ...sameMonthFilter(period.start) }, select: { id: true } })
  if (duplicate) {
    return { status: 409, error: `${employee.name} already has a review for ${monthLabel(period.start.getUTCMonth() + 1, period.start.getUTCFullYear())}. Edit that review instead.` }
  }

  const review = await prisma.$transaction(async (tx) => {
    // The bonus is paid on the review month's payslip, or the next one
    // still open if that month's is already submitted/paid.
    const payMonth = bonusAmount > 0 ? await pickPayrollMonthForClaim(tx, employeeId, period.start) : null
    return tx.performanceReview.create({
      data: {
        organizationId, employeeId, reviewerId, periodStart: period.start, periodEnd: period.end, rating: score,
        goals: goals?.trim() || null, achievements: achievements?.trim() || null, feedback: feedback?.trim() || null,
        bonusAmount, bonusPayrollMonth: payMonth?.month ?? null, bonusPayrollYear: payMonth?.year ?? null,
      },
      include: REVIEW_INCLUDE,
    })
  })
  const payslip = await applyBonusToPayslip({ organizationId, userId: reviewerId, review })

  const reviewMonth = monthLabel(period.start.getUTCMonth() + 1, period.start.getUTCFullYear())
  const bonusText = bonusAmount > 0 ? ` It includes a performance bonus of PKR ${bonusAmount.toLocaleString("en-US")} on your ${payslip.label} payslip.` : ""
  await prisma.notification.create({ data: { organizationId, recipientId: employeeId, createdById: reviewerId, type: "PERFORMANCE", title: "Performance review published", message: `Your performance review for ${reviewMonth} is available.${bonusText}`, link: "/performance" } }).catch(() => {})
  return { status: 201, review, payslip }
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
    res.json(reviews.map((r) => present(r, req.user)))
  } catch (err) { next(err) }
}

async function createPerformanceReview(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can create performance reviews" })
    const result = await createReview({ organizationId, reviewerId: userId, role, employeeId: req.params.employeeId, body: req.body })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(present(result.review, req.user, { payslip: result.payslip }))
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
      include: REVIEW_INCLUDE,
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
    })
    res.json(reviews.map((r) => present(r, req.user)))
  } catch (err) { next(err) }
}

// Org-wide create backing Performance.jsx's employee picker - same rules
// as the per-employee route, just reading employeeId from the body.
async function createPerformanceReviewForEmployee(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can create performance reviews" })
    const employeeId = req.body.employeeId
    if (!employeeId) return res.status(400).json({ error: "Employee is required" })
    const result = await createReview({ organizationId, reviewerId: userId, role, employeeId, body: req.body })
    if (result.error) return res.status(result.status).json({ error: result.error })
    res.status(201).json(present(result.review, req.user, { payslip: result.payslip }))
  } catch (err) { next(err) }
}

async function updatePerformanceReview(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can edit performance reviews" })
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, organizationId } })
    if (!review) return res.status(404).json({ error: "Review not found" })

    const { rating, goals, achievements, feedback } = req.body
    const data = {}
    if (rating !== undefined) {
      const score = Number(rating)
      if (!Number.isFinite(score) || score < 1 || score > 5) return res.status(400).json({ error: "Rating must be between 1 and 5" })
      data.rating = score
    }
    let monthChanged = false
    if (req.body.month !== undefined || req.body.periodStart !== undefined || req.body.periodEnd !== undefined) {
      const period = parsePeriod(req.body, review)
      if (period.error) return res.status(400).json({ error: period.error })
      monthChanged =
        period.start.getUTCFullYear() !== review.periodStart.getUTCFullYear() ||
        period.start.getUTCMonth() !== review.periodStart.getUTCMonth()
      if (monthChanged) {
        const duplicate = await prisma.performanceReview.findFirst({ where: { organizationId, employeeId: review.employeeId, id: { not: review.id }, ...sameMonthFilter(period.start) }, select: { id: true } })
        if (duplicate) return res.status(409).json({ error: `This employee already has a review for ${monthLabel(period.start.getUTCMonth() + 1, period.start.getUTCFullYear())}` })
      }
      data.periodStart = period.start
      data.periodEnd = period.end
    }
    if (goals !== undefined) data.goals = goals?.trim() || null
    if (achievements !== undefined) data.achievements = achievements?.trim() || null
    if (feedback !== undefined) data.feedback = feedback?.trim() || null

    const bonus = parseBonus(req.body.bonusAmount)
    if (bonus.error) return res.status(400).json({ error: bonus.error })
    const oldAmount = toNumber(review.bonusAmount)
    const newAmount = bonus.value !== undefined ? bonus.value : oldAmount
    const bonusChanged = newAmount !== oldAmount
    if (bonusChanged && !canAwardBonus(role)) return res.status(403).json({ error: "Only Admin or CEO can change a performance bonus" })
    // Moving a review with a bonus to another month moves the bonus too.
    const moveBonus = bonusChanged || (monthChanged && oldAmount > 0)
    if (moveBonus && !canAwardBonus(role)) return res.status(403).json({ error: "Only Admin or CEO can move a review that carries a bonus" })

    const oldPeriod = review.bonusPayrollMonth ? { month: review.bonusPayrollMonth, year: review.bonusPayrollYear } : null
    const updated = await prisma.$transaction(async (tx) => {
      if (moveBonus) {
        if (oldPeriod) {
          const payslip = await tx.payrollRecord.findUnique({
            where: { employeeId_month_year: { employeeId: review.employeeId, month: oldPeriod.month, year: oldPeriod.year } },
            select: { status: true },
          })
          // Once that payslip is submitted or paid, the bonus is final.
          if (payslip && payslip.status !== "DRAFT") {
            const err = new Error(`This bonus is already on the ${monthLabel(oldPeriod.month, oldPeriod.year)} payslip, which has been submitted or paid, so it can no longer be changed.`)
            err.status = 400
            throw err
          }
        }
        data.bonusAmount = newAmount
        if (newAmount === 0) {
          data.bonusPayrollMonth = null
          data.bonusPayrollYear = null
        } else {
          const period = await pickPayrollMonthForClaim(tx, review.employeeId, data.periodStart || review.periodStart)
          data.bonusPayrollMonth = period.month
          data.bonusPayrollYear = period.year
        }
      }
      return tx.performanceReview.update({ where: { id: review.id }, data, include: REVIEW_INCLUDE })
    })

    let payslip = null
    if (moveBonus) {
      const movedAway = oldPeriod && (updated.bonusPayrollMonth !== oldPeriod.month || updated.bonusPayrollYear !== oldPeriod.year)
      if (movedAway) await syncPerformanceBonus(prisma, review.employeeId, oldPeriod.month, oldPeriod.year)
      payslip = await applyBonusToPayslip({ organizationId, userId, review: updated })
    }
    res.json(present(updated, req.user, { payslip }))
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    next(err)
  }
}

async function deletePerformanceReview(req, res, next) {
  try {
    const { organizationId, role } = req.user
    if (!hasModuleAccess(role, "performance")) return res.status(403).json({ error: "Only management can delete performance reviews" })
    const review = await prisma.performanceReview.findFirst({ where: { id: req.params.id, organizationId } })
    if (!review) return res.status(404).json({ error: "Review not found" })
    if (toNumber(review.bonusAmount) > 0 && !canAwardBonus(role)) return res.status(403).json({ error: "Only Admin or CEO can delete a review that carries a bonus" })
    await prisma.performanceReview.delete({ where: { id: review.id } })
    // Removes the bonus from its payslip if that payslip is still DRAFT;
    // a submitted/paid payslip keeps what was paid.
    if (review.bonusPayrollMonth) await syncPerformanceBonus(prisma, review.employeeId, review.bonusPayrollMonth, review.bonusPayrollYear)
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
