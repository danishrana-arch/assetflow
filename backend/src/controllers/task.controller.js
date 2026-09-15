const prisma = require("../lib/prisma")
const { createNotification } = require("../utils/notifications")

const MANAGEMENT = ["ADMIN", "CEO", "SALES_HEAD", "HR", "MANAGEMENT", "DEPARTMENT_HEAD"]
const STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"]
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"]

function isManagement(role) { return MANAGEMENT.includes(role) }
function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function date(value) { if (!value) return null; const d = new Date(value); return Number.isNaN(d.getTime()) ? undefined : d }

async function listTasks(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const { projectId, status, priority, assignedToId, search } = req.query
    const where = { organizationId }
    if (!isManagement(role)) where.assignedToId = userId
    else if (assignedToId) where.assignedToId = assignedToId
    if (projectId) where.projectId = projectId
    if (STATUSES.includes(status)) where.status = status
    if (PRIORITIES.includes(priority)) where.priority = priority
    if (search) where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ]
    const tasks = await prisma.task.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true, photoUrl: true, department: { select: { name: true } } } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    })
    res.json(tasks)
  } catch (err) { next(err) }
}

async function createTask(req, res, next) {
  try {
    if (!isManagement(req.user.role)) return res.status(403).json({ error: "Only management can create tasks" })
    const { organizationId, userId } = req.user
    const { projectId, title, description, status = "TODO", priority = "MEDIUM", assignedToId, dueDate, estimatedHours = 0 } = req.body
    if (!projectId || !title?.trim()) return res.status(400).json({ error: "Project and task title are required" })
    if (!STATUSES.includes(status) || !PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid task status or priority" })
    const due = date(dueDate)
    if (due === undefined) return res.status(400).json({ error: "Invalid due date" })
    const project = await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true } })
    if (!project) return res.status(404).json({ error: "Project not found" })
    let assignee = null
    if (assignedToId) {
      assignee = await prisma.user.findFirst({ where: { id: assignedToId, organizationId, status: "ACTIVE" }, select: { id: true, name: true } })
      if (!assignee) return res.status(400).json({ error: "Invalid task assignee" })
    }
    const task = await prisma.task.create({ data: {
      organizationId, projectId, title: title.trim(), description: description?.trim() || null,
      status, priority, assignedToId: assignee?.id || null, createdById: userId, dueDate: due,
      estimatedHours: Math.max(0, number(estimatedHours)),
    }, include: { project: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } } })
    if (assignee && assignee.id !== userId) await createNotification({ organizationId, recipientId: assignee.id, createdById: userId, type: "TASK", title: "New task assigned", message: `${project.name}: ${task.title}`, link: "/tasks" })
    res.status(201).json(task)
  } catch (err) { next(err) }
}

async function updateTask(req, res, next) {
  try {
    const { organizationId, userId, role } = req.user
    const existing = await prisma.task.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Task not found" })
    const allowed = isManagement(role) || existing.assignedToId === userId
    if (!allowed) return res.status(403).json({ error: "You cannot update this task" })
    const { title, description, status, priority, assignedToId, dueDate, estimatedHours, actualHours } = req.body
    const data = {}
    if (title !== undefined) data.title = String(title).trim()
    if (description !== undefined) data.description = description?.trim() || null
    if (status !== undefined) { if (!STATUSES.includes(status)) return res.status(400).json({ error: "Invalid task status" }); data.status = status }
    if (priority !== undefined) { if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: "Invalid task priority" }); data.priority = priority }
    if (isManagement(role) && assignedToId !== undefined) {
      if (assignedToId) {
        const assignee = await prisma.user.findFirst({ where: { id: assignedToId, organizationId, status: "ACTIVE" }, select: { id: true, name: true } })
        if (!assignee) return res.status(400).json({ error: "Invalid task assignee" })
        data.assignedToId = assignee.id
      } else data.assignedToId = null
    }
    if (isManagement(role) && dueDate !== undefined) { const due = date(dueDate); if (due === undefined) return res.status(400).json({ error: "Invalid due date" }); data.dueDate = due }
    if (isManagement(role) && estimatedHours !== undefined) data.estimatedHours = Math.max(0, number(estimatedHours))
    if (actualHours !== undefined) data.actualHours = Math.max(0, number(actualHours))
    const task = await prisma.task.update({ where: { id: existing.id }, data, include: { project: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } } } })
    if (existing.assignedToId && task.status !== existing.status && existing.assignedToId !== userId) await createNotification({ organizationId, recipientId: existing.assignedToId, createdById: userId, type: "TASK", title: "Task updated", message: `${task.project.name}: ${task.title} is now ${task.status.replaceAll("_", " ")}`, link: "/tasks" })
    res.json(task)
  } catch (err) { next(err) }
}

async function deleteTask(req, res, next) {
  try {
    if (!isManagement(req.user.role)) return res.status(403).json({ error: "Only management can delete tasks" })
    const task = await prisma.task.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!task) return res.status(404).json({ error: "Task not found" })
    await prisma.task.delete({ where: { id: task.id } })
    res.status(204).send()
  } catch (err) { next(err) }
}

module.exports = { listTasks, createTask, updateTask, deleteTask }
