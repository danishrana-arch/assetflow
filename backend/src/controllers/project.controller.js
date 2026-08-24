const prisma = require("../lib/prisma")
const { ProjectStatus } = require("@prisma/client")

const projectInclude = {
  manager: { select: { id: true, name: true, email: true } },
  members: {
    include: {
      employee: {
        select: {
          id: true,
          name: true,
          email: true,
          photoUrl: true,
          role: true,
          skill: true,
          seniorityLevel: true,
          department: { select: { name: true } },
        },
      },
    },
    orderBy: { employee: { name: "asc" } },
  },
  _count: { select: { members: true } },
}

function cleanDate(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

function cleanTechnologies(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].slice(0, 20)
}

function validateCompletedLink(status, projectUrl) {
  if (status === "COMPLETED" && !String(projectUrl || "").trim()) {
    return "Project link is required when a project is marked completed"
  }
  return null
}

async function listProjects(req, res, next) {
  try {
    const { organizationId } = req.user
    const { status, search } = req.query
    const where = { organizationId }
    if (status && Object.values(ProjectStatus).includes(status)) where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { clientName: { contains: search, mode: "insensitive" } },
      ]
    }

    const projects = await prisma.project.findMany({
      where,
      include: projectInclude,
      orderBy: [{ deadline: "asc" }, { createdAt: "desc" }],
    })
    res.json(projects)
  } catch (err) { next(err) }
}

async function getProject(req, res, next) {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: projectInclude,
    })
    if (!project) return res.status(404).json({ error: "Project not found" })
    res.json(project)
  } catch (err) { next(err) }
}

async function createProject(req, res, next) {
  try {
    const { organizationId } = req.user
    const {
      name,
      description,
      clientName,
      projectUrl,
      technologies = [],
      status,
      startDate,
      deadline,
      managerId,
      memberIds = [],
    } = req.body

    if (!name?.trim()) return res.status(400).json({ error: "Project name is required" })

    const validStatuses = Object.values(ProjectStatus)
    if (status && !validStatuses.includes(status)) return res.status(400).json({ error: "Invalid project status" })

    const normalizedUrl = projectUrl?.trim() || null
    const completedLinkError = validateCompletedLink(status || "NOT_STARTED", normalizedUrl)
    if (completedLinkError) return res.status(400).json({ error: completedLinkError })

    const ids = [...new Set(Array.isArray(memberIds) ? memberIds.filter(Boolean) : [])]
    if (ids.length) {
      const count = await prisma.user.count({ where: { organizationId, id: { in: ids } } })
      if (count !== ids.length) return res.status(400).json({ error: "One or more employees are invalid" })
    }

    const manager = managerId
      ? await prisma.user.findFirst({ where: { id: managerId, organizationId }, select: { id: true } })
      : null
    if (managerId && !manager) return res.status(400).json({ error: "Invalid project manager" })

    const project = await prisma.project.create({
      data: {
        organizationId,
        name: name.trim(),
        description: description?.trim() || null,
        clientName: clientName?.trim() || null,
        projectUrl: normalizedUrl,
        technologies: cleanTechnologies(technologies),
        status: status || "NOT_STARTED",
        startDate: cleanDate(startDate) || null,
        deadline: cleanDate(deadline) || null,
        managerId: manager?.id || null,
        completedAt: status === "COMPLETED" ? new Date() : null,
        members: { create: ids.map(employeeId => ({ employeeId })) },
      },
      include: projectInclude,
    })
    res.status(201).json(project)
  } catch (err) { next(err) }
}

async function updateProject(req, res, next) {
  try {
    const { organizationId } = req.user
    const existing = await prisma.project.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Project not found" })

    const {
      name,
      description,
      clientName,
      projectUrl,
      technologies,
      status,
      startDate,
      deadline,
      managerId,
      members,
      totalHours,
    } = req.body

    if (status !== undefined && !Object.values(ProjectStatus).includes(status)) {
      return res.status(400).json({ error: "Invalid project status" })
    }

    const nextStatus = status === undefined ? existing.status : status
    const nextProjectUrl = projectUrl === undefined ? existing.projectUrl : projectUrl?.trim() || null
    const completedLinkError = validateCompletedLink(nextStatus, nextProjectUrl)
    if (completedLinkError) return res.status(400).json({ error: completedLinkError })

    const data = {}
    if (name !== undefined) data.name = String(name).trim()
    if (description !== undefined) data.description = description?.trim() || null
    if (clientName !== undefined) data.clientName = clientName?.trim() || null
    if (projectUrl !== undefined) data.projectUrl = projectUrl?.trim() || null
    if (technologies !== undefined) data.technologies = cleanTechnologies(technologies)
    if (status !== undefined) {
      data.status = status
      data.completedAt = status === "COMPLETED" ? (existing.completedAt || new Date()) : null
    }
    if (startDate !== undefined) {
      const parsed = cleanDate(startDate)
      if (parsed === undefined) return res.status(400).json({ error: "Invalid start date" })
      data.startDate = parsed
    }
    if (deadline !== undefined) {
      const parsed = cleanDate(deadline)
      if (parsed === undefined) return res.status(400).json({ error: "Invalid deadline" })
      data.deadline = parsed
      data.deadlineReminderSentAt = null
      data.deadlineOverdueNotifiedAt = null
    }
    if (managerId !== undefined) {
      if (managerId === null || managerId === "") data.managerId = null
      else {
        const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId }, select: { id: true } })
        if (!manager) return res.status(400).json({ error: "Invalid project manager" })
        data.managerId = manager.id
      }
    }
    if (totalHours !== undefined) data.totalHours = Number(totalHours) || 0

    const updated = await prisma.$transaction(async tx => {
      await tx.project.update({ where: { id: existing.id }, data })

      if (Array.isArray(members)) {
        const ids = [...new Set(members.map(m => typeof m === "string" ? m : m.employeeId).filter(Boolean))]
        const count = await tx.user.count({ where: { organizationId, id: { in: ids } } })
        if (count !== ids.length) throw Object.assign(new Error("One or more employees are invalid"), { statusCode: 400 })

        await tx.projectMember.deleteMany({ where: { projectId: existing.id } })
        if (ids.length) await tx.projectMember.createMany({ data: ids.map(employeeId => ({ projectId: existing.id, employeeId })) })
      }

      return tx.project.findUnique({ where: { id: existing.id }, include: projectInclude })
    })

    res.json(updated)
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message })
    next(err)
  }
}

async function updateMemberHours(req, res, next) {
  try {
    const { organizationId } = req.user
    const member = await prisma.projectMember.findFirst({
      where: { id: req.params.memberId, project: { id: req.params.id, organizationId } },
    })
    if (!member) return res.status(404).json({ error: "Project member not found" })

    const hoursSpent = Number(req.body.hoursSpent)
    if (!Number.isFinite(hoursSpent) || hoursSpent < 0) return res.status(400).json({ error: "hoursSpent must be a non-negative number" })

    const updated = await prisma.$transaction(async tx => {
      const result = await tx.projectMember.update({ where: { id: member.id }, data: { hoursSpent } })
      const total = await tx.projectMember.aggregate({ where: { projectId: member.projectId }, _sum: { hoursSpent: true } })
      await tx.project.update({ where: { id: member.projectId }, data: { totalHours: total._sum.hoursSpent || 0 } })
      return result
    })
    res.json(updated)
  } catch (err) { next(err) }
}

module.exports = { listProjects, getProject, createProject, updateProject, updateMemberHours }
