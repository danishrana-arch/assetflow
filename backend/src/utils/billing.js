const prisma = require("../lib/prisma")
const { isPlatformAdminUser } = require("./platform")

const FREE_PLAN_KEY = "free"
// Used only if the Free plan row has been lost from the database.
const FALLBACK_FREE_LIMIT = 2

function saleIsActive(plan, now = new Date()) {
  if (!plan.salePercent || plan.salePercent <= 0) return false
  if (plan.saleStartsAt && plan.saleStartsAt > now) return false
  if (plan.saleEndsAt && plan.saleEndsAt <= now) return false
  return true
}

// Monthly price in cents after any running sale.
function effectivePriceCents(plan, now = new Date()) {
  if (!saleIsActive(plan, now)) return plan.priceCents
  return Math.round(plan.priceCents * (100 - plan.salePercent) / 100)
}

function serializePlan(plan, now = new Date()) {
  const saleActive = saleIsActive(plan, now)
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    description: plan.description,
    priceCents: plan.priceCents,
    effectivePriceCents: effectivePriceCents(plan, now),
    currency: plan.currency,
    employeeLimit: plan.employeeLimit,
    siteLimit: plan.siteLimit,
    projectLimit: plan.projectLimit,
    organizationLimit: plan.organizationLimit,
    storageLimitMb: plan.storageLimitMb,
    billingInterval: plan.billingInterval,
    stripePriceId: plan.stripePriceId,
    featureKeys: plan.featureKeys,
    isCustom: plan.isCustom,
    features: plan.features,
    recommended: plan.recommended,
    active: plan.active,
    sortOrder: plan.sortOrder,
    sale: plan.salePercent
      ? {
          percent: plan.salePercent,
          label: plan.saleLabel,
          startsAt: plan.saleStartsAt,
          endsAt: plan.saleEndsAt,
          active: saleActive,
          // Scheduled for later, or already finished — the editor still shows it.
          status: saleActive ? "ACTIVE" : plan.saleStartsAt && plan.saleStartsAt > now ? "SCHEDULED" : "ENDED",
        }
      : null,
  }
}

// The organization's plan. No subscription row means the Free plan.
async function getPlanForOrganization(organizationId) {
  const subscription = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    include: { plan: true },
  })
  if (subscription) return { subscription, plan: subscription.plan }
  const plan = await prisma.billingPlan.findUnique({ where: { key: FREE_PLAN_KEY } })
  return { subscription: null, plan }
}

// Everyone with an account that hasn't left the company counts toward the limit.
function countBillableEmployees(organizationId, db = prisma) {
  return db.user.count({ where: { organizationId, status: { not: "LEFT_COMPANY" } } })
}

async function getEmployeeUsage(organizationId) {
  const [{ plan }, used] = await Promise.all([getPlanForOrganization(organizationId), countBillableEmployees(organizationId)])
  const limit = plan ? plan.employeeLimit : FALLBACK_FREE_LIMIT
  return {
    used,
    limit, // null = no cap
    remaining: limit == null ? null : Math.max(0, limit - used),
    limitReached: limit != null && used >= limit,
    planName: plan?.name || "Free",
  }
}

// Server-side employee cap. Returns null when `adding` more people fit,
// otherwise the 403 body to send. Called from every path that creates a user.
async function checkEmployeeCapacity(organizationId, adding = 1) {
  const usage = await getEmployeeUsage(organizationId)
  if (usage.limit == null || usage.used + adding <= usage.limit) return null
  const room = Math.max(0, usage.limit - usage.used)
  return {
    error: room === 0
      ? `Employee limit reached — the ${usage.planName} plan allows ${usage.limit} employees. Upgrade your plan to add more.`
      : `The ${usage.planName} plan allows ${usage.limit} employees and has room for ${room} more. Upgrade your plan to add more.`,
    code: "EMPLOYEE_LIMIT_REACHED",
    limit: usage.limit,
    used: usage.used,
    plan: usage.planName,
  }
}

// Who may create/edit/delete plans and sales. Plans are published by the
// ManagementDock platform account only (Control Center); companies just
// subscribe to what is published. No company role — not even a CEO — can
// change a plan.
async function canManagePlans(user) {
  return isPlatformAdminUser(user)
}

module.exports = {
  FREE_PLAN_KEY,
  saleIsActive,
  effectivePriceCents,
  serializePlan,
  getPlanForOrganization,
  getEmployeeUsage,
  checkEmployeeCapacity,
  countBillableEmployees,
  canManagePlans,
}
