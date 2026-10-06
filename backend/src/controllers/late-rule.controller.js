const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")
const { RESULTS, DEDUCT_FROM, describeRule } = require("../utils/late-rules")
const { refreshAllDraftPayslips } = require("./payroll.controller")

// Company late-arrival rules (LatePolicyRule) — full CRUD, per organization
// (the one selected in the switcher). Everyone in the company can read them
// (they're shown on the leave policy); ADMIN / CEO / HR manage them. Every
// change refreshes the company's DRAFT payslips so pay follows the rules.

const MAX_RULES = 10

function serialize(rule) {
  return { ...rule, description: describeRule(rule) }
}

function parseRule(body, existing) {
  const data = {}
  if (body.name !== undefined || !existing) {
    const name = typeof body.name === "string" ? body.name.trim() : ""
    if (!name) return { error: "Give the rule a name" }
    if (name.length > 80) return { error: "Name is too long (max 80 characters)" }
    data.name = name
  }
  if (body.lateCount !== undefined || !existing) {
    const n = Number(body.lateCount)
    if (!Number.isInteger(n) || n < 1 || n > 31) return { error: "Late arrivals must be a whole number from 1 to 31" }
    data.lateCount = n
  }
  if (body.result !== undefined || !existing) {
    const result = body.result || "HALF_DAY"
    if (!Object.keys(RESULTS).includes(result)) return { error: "Result must be HALF_DAY or FULL_DAY" }
    data.result = result
  }
  if (body.deductFrom !== undefined || !existing) {
    const from = body.deductFrom || "LEAVE"
    if (!DEDUCT_FROM.includes(from)) return { error: "Deduct from must be LEAVE or SALARY" }
    data.deductFrom = from
  }
  if (body.replaceLateFine !== undefined) data.replaceLateFine = Boolean(body.replaceLateFine)
  if (body.active !== undefined) data.active = Boolean(body.active)
  return { data }
}

// GET /late-rules
async function listLateRules(req, res, next) {
  try {
    const rules = await prisma.latePolicyRule.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ active: "desc" }, { lateCount: "desc" }, { createdAt: "asc" }],
    })
    res.json(rules.map(serialize))
  } catch (err) {
    next(err)
  }
}

async function afterChange(req, action, rule, note) {
  const { organizationId, userId } = req.user
  logAudit({ organizationId, actorId: userId, action, targetType: "LatePolicyRule", targetId: rule.id, note })
  return refreshAllDraftPayslips(organizationId)
}

// POST /late-rules
async function createLateRule(req, res, next) {
  try {
    const { organizationId, userId } = req.user
    const parsed = parseRule(req.body, null)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const count = await prisma.latePolicyRule.count({ where: { organizationId } })
    if (count >= MAX_RULES) return res.status(400).json({ error: `A company can have at most ${MAX_RULES} late-arrival rules` })
    const rule = await prisma.latePolicyRule.create({ data: { ...parsed.data, organizationId, createdById: userId } })
    const refreshed = await afterChange(req, "late_rule.created", rule, describeRule(rule))
    res.status(201).json({ rule: serialize(rule), draftPayslipsRefreshed: refreshed })
  } catch (err) {
    next(err)
  }
}

// PATCH /late-rules/:id
async function updateLateRule(req, res, next) {
  try {
    const existing = await prisma.latePolicyRule.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!existing) return res.status(404).json({ error: "Rule not found" })
    const parsed = parseRule(req.body, existing)
    if (parsed.error) return res.status(400).json({ error: parsed.error })
    const rule = await prisma.latePolicyRule.update({ where: { id: existing.id }, data: parsed.data })
    const refreshed = await afterChange(req, "late_rule.updated", rule, `${describeRule(existing)} -> ${describeRule(rule)}${rule.active ? "" : " (off)"}`)
    res.json({ rule: serialize(rule), draftPayslipsRefreshed: refreshed })
  } catch (err) {
    next(err)
  }
}

// DELETE /late-rules/:id
async function deleteLateRule(req, res, next) {
  try {
    const existing = await prisma.latePolicyRule.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!existing) return res.status(404).json({ error: "Rule not found" })
    await prisma.latePolicyRule.delete({ where: { id: existing.id } })
    const refreshed = await afterChange(req, "late_rule.deleted", existing, describeRule(existing))
    res.json({ deleted: true, draftPayslipsRefreshed: refreshed })
  } catch (err) {
    next(err)
  }
}

module.exports = { listLateRules, createLateRule, updateLateRule, deleteLateRule }
