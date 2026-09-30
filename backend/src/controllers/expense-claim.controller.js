const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { notifyManagement, createNotification } = require("../utils/notifications")
const { syncExpenseReimbursement, pickPayrollMonthForClaim } = require("../utils/payroll")

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const MAX_AMOUNT = 10000000

function formatPkr(n) {
  return `PKR ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

const CLAIM_INCLUDE = {
  employee: { select: { id: true, name: true, email: true, photoUrl: true, department: { select: { name: true } } } },
  reviewedBy: { select: { id: true, name: true, role: true } },
}

// Self-service calls resolve the employee's real employer from their User
// row — req.user.organizationId can be switched for the request by
// applyOrganizationScope (main-company ADMIN/IT viewing another org).
async function homeOrganizationId(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } })
  return user?.organizationId
}

// GET /api/expense-claims/me — the caller's own claims, newest first.
async function listMyClaims(req, res, next) {
  try {
    const claims = await prisma.expenseClaim.findMany({
      where: { employeeId: req.user.userId },
      include: { reviewedBy: CLAIM_INCLUDE.reviewedBy },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
    })
    res.json(claims)
  } catch (err) {
    next(err)
  }
}

// POST /api/expense-claims  { title, amount, expenseDate, description }
async function createClaim(req, res, next) {
  try {
    const { userId } = req.user
    const title = String(req.body.title || "").trim().slice(0, 120)
    const description = String(req.body.description || "").trim().slice(0, 1000) || null
    const amount = Math.round(Number(req.body.amount) * 100) / 100
    const expenseDate = req.body.expenseDate ? new Date(req.body.expenseDate) : new Date()

    if (!title) return res.status(400).json({ error: "Title is required" })
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be greater than 0" })
    if (amount > MAX_AMOUNT) return res.status(400).json({ error: "Amount is too large" })
    if (Number.isNaN(expenseDate.getTime())) return res.status(400).json({ error: "Expense date is not valid" })
    if (expenseDate.getTime() > Date.now() + 86400000) {
      return res.status(400).json({ error: "Expense date can't be in the future" })
    }

    const organizationId = await homeOrganizationId(userId)
    if (!organizationId) return res.status(404).json({ error: "User not found" })

    const claim = await prisma.expenseClaim.create({
      data: { organizationId, employeeId: userId, title, amount, description, expenseDate },
      include: CLAIM_INCLUDE,
    })

    notifyManagement({
      organizationId,
      createdById: userId,
      type: "REQUEST",
      title: "New expense claim",
      message: `${claim.employee.name}: ${title} — ${formatPkr(amount)}`,
      link: "/expense-claims",
      moduleKey: "expenseClaims",
    }).catch((err) => console.error("expense claim notify failed:", err))

    res.status(201).json(claim)
  } catch (err) {
    next(err)
  }
}

// DELETE /api/expense-claims/:id — withdraw your own claim while it's
// still PENDING. Reviewed claims are kept as a record.
async function deleteClaim(req, res, next) {
  try {
    const claim = await prisma.expenseClaim.findFirst({ where: { id: req.params.id, employeeId: req.user.userId } })
    if (!claim) return res.status(404).json({ error: "Expense claim not found" })
    if (claim.status !== "PENDING") return res.status(400).json({ error: "Only a pending claim can be withdrawn" })
    await prisma.expenseClaim.delete({ where: { id: claim.id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

// GET /api/expense-claims?status=PENDING|APPROVED|REJECTED — reviewers
// (HR/ADMIN/CEO) see every claim in the organization.
async function listClaims(req, res, next) {
  try {
    const { organizationId } = req.user
    const status = ["PENDING", "APPROVED", "REJECTED"].includes(req.query.status) ? req.query.status : undefined
    const claims = await prisma.expenseClaim.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      include: CLAIM_INCLUDE,
      orderBy: [{ createdAt: "desc" }],
      take: 500,
    })
    res.json(claims)
  } catch (err) {
    next(err)
  }
}

async function loadReviewable(req, res) {
  const { organizationId, userId } = req.user
  const claim = await prisma.expenseClaim.findFirst({ where: { id: req.params.id, organizationId } })
  if (!claim) {
    res.status(404).json({ error: "Expense claim not found" })
    return null
  }
  if (claim.employeeId === userId) {
    res.status(403).json({ error: "You can't review your own expense claim" })
    return null
  }
  if (claim.status !== "PENDING") {
    res.status(400).json({ error: "This claim has already been reviewed" })
    return null
  }
  return claim
}

// POST /api/expense-claims/:id/approve  { note }
// Assigns the claim to a payroll month and adds it to that month's
// payslip (right away if the payslip is already generated and still
// DRAFT, otherwise whenever that month is generated).
async function approveClaim(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const claim = await loadReviewable(req, res)
    if (!claim) return

    const updated = await prisma.$transaction(async (tx) => {
      const { month, year } = await pickPayrollMonthForClaim(tx, claim.employeeId, claim.expenseDate)
      const result = await tx.expenseClaim.update({
        where: { id: claim.id },
        data: {
          status: "APPROVED",
          payrollMonth: month,
          payrollYear: year,
          reviewedById: userId,
          reviewedAt: new Date(),
          reviewNote: String(req.body.note || "").trim().slice(0, 1000) || null,
        },
        include: CLAIM_INCLUDE,
      })
      await syncExpenseReimbursement(tx, claim.employeeId, month, year)
      return result
    })

    const period = `${MONTHS[updated.payrollMonth - 1]} ${updated.payrollYear}`
    createNotification({
      organizationId: claim.organizationId,
      recipientId: claim.employeeId,
      createdById: userId,
      type: "INFO",
      title: "Expense claim approved",
      message: `${claim.title} — ${formatPkr(claim.amount)} will be added to your ${period} payslip.`,
      link: "/payroll/me",
    }).catch((err) => console.error("expense claim notify failed:", err))
    logAudit({ organizationId, actorId: userId, action: "expense_claim.approved", targetType: "ExpenseClaim", targetId: claim.id, note: `${claim.title} — ${formatPkr(claim.amount)} → ${period}` })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

// POST /api/expense-claims/:id/reject  { note }
async function rejectClaim(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const claim = await loadReviewable(req, res)
    if (!claim) return

    const note = String(req.body.note || "").trim().slice(0, 1000) || null
    const updated = await prisma.expenseClaim.update({
      where: { id: claim.id },
      data: { status: "REJECTED", reviewedById: userId, reviewedAt: new Date(), reviewNote: note },
      include: CLAIM_INCLUDE,
    })

    createNotification({
      organizationId: claim.organizationId,
      recipientId: claim.employeeId,
      createdById: userId,
      type: "INFO",
      title: "Expense claim rejected",
      message: `${claim.title} — ${formatPkr(claim.amount)}${note ? `: ${note}` : ""}`,
      link: "/payroll/me",
    }).catch((err) => console.error("expense claim notify failed:", err))
    logAudit({ organizationId, actorId: userId, action: "expense_claim.rejected", targetType: "ExpenseClaim", targetId: claim.id, note: claim.title })

    res.json(updated)
  } catch (err) {
    next(err)
  }
}

module.exports = { listMyClaims, createClaim, deleteClaim, listClaims, approveClaim, rejectClaim }
