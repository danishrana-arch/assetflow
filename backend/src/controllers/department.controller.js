const prisma = require("../lib/prisma")

async function listDepartments(req, res, next) {
  try {
    const { organizationId } = req.user
    const departments = await prisma.department.findMany({
      where: { organizationId },
      include: {
        manager: { select: { id: true, name: true, email: true, role: true } },
        _count: { select: { employees: true, assets: true } },
      },
      orderBy: { name: "asc" },
    })
    res.json(departments)
  } catch (err) { next(err) }
}

async function createDepartment(req, res, next) {
  try {
    const { organizationId } = req.user
    const { name, managerId } = req.body
    if (!name?.trim()) return res.status(400).json({ error: "name is required" })
    if (managerId) {
      const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId, status: "ACTIVE" }, select: { id: true } })
      if (!manager) return res.status(400).json({ error: "Invalid department manager" })
    }
    const department = await prisma.department.create({
      data: { organizationId, name: name.trim(), managerId: managerId || null },
      include: { manager: { select: { id: true, name: true, email: true, role: true } }, _count: { select: { employees: true, assets: true } } },
    })
    res.status(201).json(department)
  } catch (err) { next(err) }
}

async function updateDepartment(req, res, next) {
  try {
    const { organizationId } = req.user
    const existing = await prisma.department.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Department not found" })
    const { name, managerId } = req.body
    const data = {}
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: "Department name cannot be empty" })
      data.name = String(name).trim()
    }
    if (managerId !== undefined) {
      if (managerId) {
        const manager = await prisma.user.findFirst({ where: { id: managerId, organizationId, status: "ACTIVE" }, select: { id: true } })
        if (!manager) return res.status(400).json({ error: "Invalid department manager" })
      }
      data.managerId = managerId || null
    }
    const department = await prisma.department.update({ where: { id: existing.id }, data, include: { manager: { select: { id: true, name: true, email: true, role: true } }, _count: { select: { employees: true, assets: true } } } })
    res.json(department)
  } catch (err) { next(err) }
}

async function deleteDepartment(req, res, next) {
  try {
    const { organizationId } = req.user
    const existing = await prisma.department.findFirst({ where: { id: req.params.id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Department not found" })
    await prisma.department.delete({ where: { id: existing.id } })
    res.status(204).send()
  } catch (err) { next(err) }
}

module.exports = { listDepartments, createDepartment, updateDepartment, deleteDepartment }
