const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { sendEmail, escapeHtml } = require("../utils/mailer")
const payments = require("../services/billing-payments")
const { FEATURE_KEYS, clearEntitlementCache } = require("../utils/features")
const {
  FREE_PLAN_KEY,
  effectivePriceCents,
  serializePlan,
  getPlanForOrganization,
  getEmployeeUsage,
  canManagePlans,
} = require("../utils/billing")

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_PRICE_CENTS = 10000000
const INQUIRY_STATUSES = ["NEW", "CONTACTED", "CLOSED"]

const text = (value, max) => {
  if (value == null) return null
  const t = String(value).trim().slice(0, max)
  return t || null
}

function wholeNumber(value, { min, max }) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) return undefined
  return n
}

// ── Subscription ─────────────────────────────────────────────────────────

// GET /billing/subscription — current plan + employee usage + capabilities.
async function getSubscription(req, res, next) {
  try {
    const { organizationId } = req.user
    const [{ subscription, plan }, usage, canManage] = await Promise.all([
      getPlanForOrganization(organizationId),
      getEmployeeUsage(organizationId),
      canManagePlans(req.user),
    ])
    const paid = !!subscription && subscription.priceCents > 0
    res.json({
      plan: plan ? serializePlan(plan) : null,
      status: subscription?.status || "ACTIVE",
      monthlyCostCents: subscription?.priceCents || 0,
      nextBillingDate: paid ? subscription.currentPeriodEnd : null,
      usage,
      canManagePlans: canManage,
      paymentsConfigured: payments.isConfigured(),
    })
  } catch (err) {
    next(err)
  }
}

// POST /billing/subscription { planKey } — move to another plan. Free plans
// switch immediately; paid plans go through the payment provider's checkout.
async function changePlan(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const target = await prisma.billingPlan.findUnique({ where: { key: String(req.body.planKey || "") } })
    if (!target || !target.active) return res.status(404).json({ error: "Plan not found" })
    if (target.isCustom) {
      return res.status(400).json({ error: "The Custom plan is arranged with our team — use “Contact Our Team”.", code: "CONTACT_SALES" })
    }

    const { subscription, plan: current } = await getPlanForOrganization(organizationId)
    if (current && current.id === target.id) return res.status(400).json({ error: `You're already on the ${target.name} plan.` })

    const usage = await getEmployeeUsage(organizationId)
    if (target.employeeLimit != null && usage.used > target.employeeLimit) {
      const over = usage.used - target.employeeLimit
      return res.status(409).json({
        error: `The ${target.name} plan allows ${target.employeeLimit} employees but you have ${usage.used}. Remove or mark ${over} as “Left Company” first.`,
        code: "DOWNGRADE_BLOCKED",
      })
    }

    const price = effectivePriceCents(target)
    if (price > 0) {
      try {
        const session = await payments.createCheckoutSession({ organizationId, plan: target, priceCents: price })
        return res.json({ checkoutUrl: session.url })
      } catch (err) {
        if (err.code === "PAYMENT_NOT_CONFIGURED") return res.status(402).json({ error: err.message, code: err.code })
        throw err
      }
    }

    await payments.cancelSubscription({ organizationId, subscription })
    const data = {
      planId: target.id,
      status: "ACTIVE",
      priceCents: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
    }
    await prisma.organizationSubscription.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    })
    logAudit({
      organizationId,
      actorId: userId,
      action: "billing.plan_changed",
      targetType: "Organization",
      targetId: organizationId,
      note: `${current?.name || "Free"} → ${target.name}`,
    })
    res.json({ changed: true, plan: serializePlan(target) })
  } catch (err) {
    next(err)
  }
}

// POST /billing/portal — "Manage Billing" (customer portal).
async function openPortal(req, res, next) {
  try {
    const session = await payments.createPortalSession({ organizationId: req.user.organizationId })
    res.json({ url: session.url })
  } catch (err) {
    if (err.code === "PAYMENT_NOT_CONFIGURED") return res.status(402).json({ error: err.message, code: err.code })
    next(err)
  }
}

// ── Invoices ─────────────────────────────────────────────────────────────

async function listInvoices(req, res, next) {
  try {
    const invoices = await prisma.billingInvoice.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { issuedAt: "desc" },
      take: 100,
    })
    res.json(invoices)
  } catch (err) {
    next(err)
  }
}

// ── Plans (create / read / update / delete) + sales ──────────────────────

async function requirePlanManager(req, res) {
  if (await canManagePlans(req.user)) return true
  res.status(403).json({ error: "Plans are published by the ManagementDock platform team only" })
  return false
}

// GET /billing/plans — visible plans; managers also see inactive ones.
async function listPlans(req, res, next) {
  try {
    const canManage = await canManagePlans(req.user)
    const plans = await prisma.billingPlan.findMany({
      where: canManage ? {} : { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    res.json(plans.map((p) => serializePlan(p)))
  } catch (err) {
    next(err)
  }
}

// Validates the editable plan fields; `partial` skips the ones not sent.
function parsePlanInput(body, { partial }) {
  const out = {}
  const has = (k) => body[k] !== undefined

  if (!partial || has("name")) {
    const name = text(body.name, 60)
    if (!name) return { error: "Plan name is required" }
    out.name = name
  }
  if (has("description")) out.description = text(body.description, 300) || ""
  if (!partial || has("priceCents")) {
    const price = wholeNumber(body.priceCents ?? 0, { min: 0, max: MAX_PRICE_CENTS })
    if (price === undefined) return { error: "Price must be between $0 and $100,000" }
    out.priceCents = price
  }
  if (has("employeeLimit")) {
    if (body.employeeLimit === null || body.employeeLimit === "") out.employeeLimit = null
    else {
      const limit = wholeNumber(body.employeeLimit, { min: 1, max: 1000000 })
      if (limit === undefined) return { error: "Employee limit must be a whole number of 1 or more (or empty for no cap)" }
      out.employeeLimit = limit
    }
  }
  // Other limits — empty = no cap. Only the employee limit is enforced; the
  // rest produce usage warnings in the Control Center.
  for (const [field, max, label] of [["siteLimit", 100000, "Site limit"], ["projectLimit", 100000, "Project limit"], ["organizationLimit", 10000, "Organization limit"], ["storageLimitMb", 10000000, "Storage limit"]]) {
    if (!has(field)) continue
    if (body[field] === null || body[field] === "") out[field] = null
    else {
      const n = wholeNumber(body[field], { min: 1, max })
      if (n === undefined) return { error: `${label} must be a whole number of 1 or more (or empty for no cap)` }
      out[field] = n
    }
  }
  if (has("stripePriceId")) out.stripePriceId = text(body.stripePriceId, 120)
  if (has("featureKeys")) {
    if (!Array.isArray(body.featureKeys)) return { error: "Included features must be a list" }
    const unknown = body.featureKeys.filter((k) => !FEATURE_KEYS.includes(k))
    if (unknown.length) return { error: `Unknown feature: ${unknown[0]}` }
    out.featureKeys = [...new Set(body.featureKeys)]
  }
  if (has("isCustom")) out.isCustom = !!body.isCustom
  if (has("recommended")) out.recommended = !!body.recommended
  if (has("active")) out.active = !!body.active
  if (has("sortOrder")) {
    const order = wholeNumber(body.sortOrder, { min: 0, max: 1000 })
    if (order === undefined) return { error: "Sort order must be a whole number" }
    out.sortOrder = order
  }
  if (has("features")) {
    if (!Array.isArray(body.features)) return { error: "Features must be a list" }
    const features = body.features.map((f) => text(f, 120)).filter(Boolean)
    if (features.length > 20) return { error: "A plan can list at most 20 features" }
    out.features = features
  }
  return { data: out }
}

// POST /billing/plans
async function createPlan(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const key = String(req.body.key || "").trim().toLowerCase()
    if (!KEY_RE.test(key)) return res.status(400).json({ error: "Plan key must be lowercase letters, numbers and dashes (e.g. “team-plus”)" })
    const { data, error } = parsePlanInput(req.body, { partial: false })
    if (error) return res.status(400).json({ error })
    if (await prisma.billingPlan.findUnique({ where: { key }, select: { id: true } })) {
      return res.status(409).json({ error: "A plan with this key already exists" })
    }
    if (data.isCustom) data.priceCents = 0

    const plan = await prisma.$transaction(async (tx) => {
      if (data.recommended) await tx.billingPlan.updateMany({ data: { recommended: false } })
      const last = await tx.billingPlan.aggregate({ _max: { sortOrder: true } })
      return tx.billingPlan.create({
        data: { features: [], featureKeys: FEATURE_KEYS, ...data, key, sortOrder: data.sortOrder ?? (last._max.sortOrder || 0) + 1 },
      })
    })
    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "billing.plan_created", targetType: "BillingPlan", targetId: plan.id, note: plan.name })
    res.status(201).json(serializePlan(plan))
  } catch (err) {
    next(err)
  }
}

// PATCH /billing/plans/:id — a price change applies to new subscriptions only
// (existing ones keep the price they signed up at); a limit change applies to
// everyone on the plan immediately.
async function updatePlan(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const existing = await prisma.billingPlan.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: "Plan not found" })
    const { data, error } = parsePlanInput(req.body, { partial: true })
    if (error) return res.status(400).json({ error })
    if (existing.key === FREE_PLAN_KEY) {
      if (data.active === false) return res.status(400).json({ error: "The Free plan can't be deactivated — it's the default for new companies" })
      if (data.priceCents) return res.status(400).json({ error: "The Free plan must stay free" })
    }
    if (data.isCustom || (data.isCustom === undefined && existing.isCustom)) data.priceCents = 0
    if (data.priceCents === 0 || data.isCustom) {
      // Nothing to discount any more.
      Object.assign(data, { salePercent: null, saleLabel: null, saleStartsAt: null, saleEndsAt: null })
    }

    const plan = await prisma.$transaction(async (tx) => {
      if (data.recommended) await tx.billingPlan.updateMany({ where: { id: { not: existing.id } }, data: { recommended: false } })
      return tx.billingPlan.update({ where: { id: existing.id }, data })
    })
    if (data.featureKeys) clearEntitlementCache()
    const pick = (p) => ({ priceCents: p.priceCents, employeeLimit: p.employeeLimit, siteLimit: p.siteLimit, projectLimit: p.projectLimit, organizationLimit: p.organizationLimit, storageLimitMb: p.storageLimitMb, featureKeys: p.featureKeys, active: p.active, stripePriceId: p.stripePriceId })
    logAudit({
      organizationId: req.user.organizationId,
      actorId: req.user.userId,
      action: "billing.plan_updated",
      targetType: "BillingPlan",
      targetId: plan.id,
      note: plan.name,
      details: { before: pick(existing), after: pick(plan) },
    })
    res.json(serializePlan(plan))
  } catch (err) {
    next(err)
  }
}

// DELETE /billing/plans/:id — only a plan nobody is on.
async function deletePlan(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const plan = await prisma.billingPlan.findUnique({ where: { id: req.params.id }, include: { _count: { select: { subscriptions: true } } } })
    if (!plan) return res.status(404).json({ error: "Plan not found" })
    if (plan.key === FREE_PLAN_KEY) return res.status(400).json({ error: "The Free plan can't be deleted — it's the default for new companies" })
    if (plan._count.subscriptions > 0) {
      return res.status(409).json({
        error: `${plan._count.subscriptions} ${plan._count.subscriptions === 1 ? "company is" : "companies are"} on this plan. Deactivate it instead so it's hidden from new sign-ups.`,
      })
    }
    await prisma.billingPlan.delete({ where: { id: plan.id } })
    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "billing.plan_deleted", targetType: "BillingPlan", targetId: plan.id, note: plan.name })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

function parseSaleDate(value) {
  if (value == null || value === "") return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? undefined : d
}

// PUT /billing/plans/:id/sale { percent, label, startsAt, endsAt }
async function setSale(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const plan = await prisma.billingPlan.findUnique({ where: { id: req.params.id } })
    if (!plan) return res.status(404).json({ error: "Plan not found" })
    if (plan.isCustom || plan.priceCents <= 0) return res.status(400).json({ error: "A sale needs a paid, non-custom plan" })

    const percent = wholeNumber(req.body.percent, { min: 1, max: 99 })
    if (percent === undefined) return res.status(400).json({ error: "Discount must be a whole number from 1 to 99 percent" })
    const startsAt = parseSaleDate(req.body.startsAt)
    const endsAt = parseSaleDate(req.body.endsAt)
    if (startsAt === undefined || endsAt === undefined) return res.status(400).json({ error: "Sale dates must be valid dates" })
    if (endsAt && endsAt <= new Date()) return res.status(400).json({ error: "The sale end date must be in the future" })
    if (startsAt && endsAt && endsAt <= startsAt) return res.status(400).json({ error: "The sale must end after it starts" })

    const updated = await prisma.billingPlan.update({
      where: { id: plan.id },
      data: { salePercent: percent, saleLabel: text(req.body.label, 40), saleStartsAt: startsAt, saleEndsAt: endsAt },
    })
    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "billing.sale_set", targetType: "BillingPlan", targetId: plan.id, note: `${plan.name}: ${percent}% off` })
    res.json(serializePlan(updated))
  } catch (err) {
    next(err)
  }
}

// DELETE /billing/plans/:id/sale — end a sale.
async function clearSale(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const plan = await prisma.billingPlan.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } })
    if (!plan) return res.status(404).json({ error: "Plan not found" })
    const updated = await prisma.billingPlan.update({
      where: { id: plan.id },
      data: { salePercent: null, saleLabel: null, saleStartsAt: null, saleEndsAt: null },
    })
    logAudit({ organizationId: req.user.organizationId, actorId: req.user.userId, action: "billing.sale_ended", targetType: "BillingPlan", targetId: plan.id, note: plan.name })
    res.json(serializePlan(updated))
  } catch (err) {
    next(err)
  }
}

// ── Contact Our Team (Custom plan) ───────────────────────────────────────

// POST /billing/inquiries
async function createInquiry(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const name = text(req.body.name, 120)
    const email = text(req.body.email, 200)?.toLowerCase()
    const message = text(req.body.message, 2000)
    if (!name) return res.status(400).json({ error: "Your name is required" })
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email address is required" })
    if (!message) return res.status(400).json({ error: "Tell us a little about what you need" })
    let employeeCount = null
    if (req.body.employeeCount !== undefined && req.body.employeeCount !== "" && req.body.employeeCount !== null) {
      employeeCount = wholeNumber(req.body.employeeCount, { min: 1, max: 1000000 })
      if (employeeCount === undefined) return res.status(400).json({ error: "Employee count must be a whole number" })
    }
    const company = text(req.body.company, 160)

    const inquiry = await prisma.salesInquiry.create({
      data: { organizationId, requestedById: userId, name, email, company, employeeCount, message },
    })
    logAudit({ organizationId, actorId: userId, action: "billing.inquiry_sent", targetType: "SalesInquiry", targetId: inquiry.id, note: `${name} <${email}>` })

    // Best effort — the inquiry is saved either way.
    const salesEmail = process.env.SALES_EMAIL
    let emailed = false
    if (salesEmail) {
      try {
        emailed = await sendEmail({
          to: salesEmail,
          subject: `Custom plan inquiry from ${company || name}`,
          text: `${name} <${email}>\nCompany: ${company || "—"}\nEmployees: ${employeeCount ?? "—"}\n\n${message}`,
          html: `<p><b>${escapeHtml(name)}</b> &lt;${escapeHtml(email)}&gt;<br/>Company: ${escapeHtml(company || "—")}<br/>Employees: ${employeeCount ?? "—"}</p><p>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
        })
      } catch (err) {
        console.error("sales inquiry email failed:", err.message)
      }
    }
    res.status(201).json({ inquiry, emailed })
  } catch (err) {
    next(err)
  }
}

// GET /billing/inquiries — plan managers see every inquiry; everyone else
// only their own company's.
async function listInquiries(req, res, next) {
  try {
    const canManage = await canManagePlans(req.user)
    const inquiries = await prisma.salesInquiry.findMany({
      where: canManage ? {} : { organizationId: req.user.organizationId },
      include: canManage ? { organization: { select: { name: true } } } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    res.json(inquiries)
  } catch (err) {
    next(err)
  }
}

// PATCH /billing/inquiries/:id { status }
async function updateInquiry(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    if (!INQUIRY_STATUSES.includes(req.body.status)) return res.status(400).json({ error: `Status must be one of: ${INQUIRY_STATUSES.join(", ")}` })
    const existing = await prisma.salesInquiry.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) return res.status(404).json({ error: "Inquiry not found" })
    const inquiry = await prisma.salesInquiry.update({ where: { id: existing.id }, data: { status: req.body.status }, include: { organization: { select: { name: true } } } })
    res.json(inquiry)
  } catch (err) {
    next(err)
  }
}

// DELETE /billing/inquiries/:id
async function deleteInquiry(req, res, next) {
  try {
    if (!(await requirePlanManager(req, res))) return
    const existing = await prisma.salesInquiry.findUnique({ where: { id: req.params.id }, select: { id: true } })
    if (!existing) return res.status(404).json({ error: "Inquiry not found" })
    await prisma.salesInquiry.delete({ where: { id: existing.id } })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}

module.exports = {
  getSubscription,
  changePlan,
  openPortal,
  listInvoices,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  setSale,
  clearSale,
  createInquiry,
  listInquiries,
  updateInquiry,
  deleteInquiry,
}
