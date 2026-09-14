const prisma = require("../lib/prisma")
const { createNotification } = require("../utils/notifications")
const MANAGEMENT = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]
const isManagement = role => MANAGEMENT.includes(role)
function cleanDate(v) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d }
async function listTimeEntries(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const where = { organizationId }
    if (!isManagement(role)) where.employeeId = userId
    else if (req.query.employeeId) where.employeeId = req.query.employeeId
    if (req.query.from) { const d = cleanDate(req.query.from); if (d) where.date = { ...(where.date || {}), gte: d } }
    if (req.query.to) { const d = cleanDate(req.query.to); if (d) where.date = { ...(where.date || {}), lte: d } }
    const rows = await prisma.timeEntry.findMany({ where, include: { employee: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } } }, orderBy: { date: "desc" } })
    res.json(rows)
  } catch (err) { next(err) }
}
async function createTimeEntry(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const employeeId = isManagement(role) && req.body.employeeId ? req.body.employeeId : userId
    const { projectId, taskId, date: dateValue, hours, note } = req.body
    const date = cleanDate(dateValue)
    const h = Number(hours)
    if (!date || !Number.isFinite(h) || h <= 0 || h > 24) return res.status(400).json({ error: "Enter a valid date and hours between 0 and 24" })
    const employee = await prisma.user.findFirst({ where: { id: employeeId, organizationId, status: "ACTIVE" }, select: { id: true, name: true } })
    if (!employee) return res.status(400).json({ error: "Invalid employee" })
    if (projectId) { const p = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } }); if (!p) return res.status(400).json({ error: "Invalid project" }) }
    if (taskId) { const t = await prisma.task.findFirst({ where: { id: taskId, organizationId, ...(projectId ? { projectId } : {}) }, select: { id: true, projectId: true } }); if (!t) return res.status(400).json({ error: "Invalid task" }) }
    const entry = await prisma.timeEntry.create({ data: { organizationId, employeeId, projectId: projectId || null, taskId: taskId || null, date, hours: h, note: note?.trim() || null }, include: { project: { select: { id: true, name: true } }, task: { select: { id: true, title: true } }, employee: { select: { id: true, name: true } } } })
    if (taskId) await prisma.task.update({ where: { id: taskId }, data: { actualHours: { increment: h } } })
    if (isManagement(role) && employeeId !== userId) await createNotification({ organizationId, recipientId: employeeId, createdById: userId, type: "TIMESHEET", title: "Timesheet entry added", message: `A ${h}-hour entry was added to your timesheet`, link: "/timesheets" })
    res.status(201).json(entry)
  } catch (err) { next(err) }
}
async function deleteTimeEntry(req, res, next) {
  try {
    const row = await prisma.timeEntry.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!row) return res.status(404).json({ error: "Time entry not found" })
    if (!isManagement(req.user.role) && row.employeeId !== req.user.userId) return res.status(403).json({ error: "You cannot delete this entry" })
    await prisma.$transaction(async tx => {
      await tx.timeEntry.delete({ where: { id: row.id } })
      if (row.taskId) await tx.task.update({ where: { id: row.taskId }, data: { actualHours: { decrement: row.hours } } })
    })
    res.status(204).send()
  } catch (err) { next(err) }
}
module.exports = { listTimeEntries, createTimeEntry, deleteTimeEntry }
