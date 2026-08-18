const prisma = require("../lib/prisma")

async function listDepartments(req, res, next) {
  try {
    const { organizationId } = req.user
    const departments = await prisma.department.findMany({
      where: { organizationId },
      include: { _count: { select: { employees: true, assets: true } } },
      orderBy: { name: "asc" },
    })
    res.json(departments)
  } catch (err) {
    next(err)
  }
}

async function createDepartment(req, res, next) {
  try {
    const { organizationId } = req.user
    const { name } = req.body
    if (!name) return res.status(400).json({ error: "name is required" })

    const department = await prisma.department.create({ data: { organizationId, name } })
    res.status(201).json(department)
  } catch (err) {
    next(err)
  }
}

async function deleteDepartment(req, res, next) {
  try {
    const { organizationId } = req.user
    const { id } = req.params

    const existing = await prisma.department.findFirst({ where: { id, organizationId } })
    if (!existing) return res.status(404).json({ error: "Department not found" })

    await prisma.department.delete({ where: { id } })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { listDepartments, createDepartment, deleteDepartment }
