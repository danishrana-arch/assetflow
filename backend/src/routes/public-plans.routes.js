const express = require("express")
const prisma = require("../lib/prisma")
const { serializePlan } = require("../utils/billing")

const router = express.Router()

// GET /api/public/plans — the active pricing plans, for the logged-out
// landing page. Read-only; internal fields (payment-provider price id,
// feature keys, ids) are deliberately left out.
router.get("/", async (_req, res, next) => {
  try {
    const plans = await prisma.billingPlan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    res.set("Cache-Control", "public, max-age=60")
    res.json(
      plans.map((p) => {
        const s = serializePlan(p)
        return {
          key: s.key,
          name: s.name,
          description: s.description,
          priceCents: s.priceCents,
          effectivePriceCents: s.effectivePriceCents,
          currency: s.currency,
          employeeLimit: s.employeeLimit,
          isCustom: s.isCustom,
          features: s.features,
          recommended: s.recommended,
          sale: s.sale?.active ? { percent: s.sale.percent, label: s.sale.label, endsAt: s.sale.endsAt } : null,
        }
      })
    )
  } catch (err) {
    next(err)
  }
})

module.exports = router
