const prisma = require("../lib/prisma")

const DEFAULTS = [
  { name: "Construction", technologies: ["AutoCAD", "Revit", "Bluebeam", "PlanSwift", "Primavera P6", "MS Project"] },
  { name: "Estimation", technologies: ["Bluebeam", "PlanSwift", "CostX", "RSMeans", "Excel"] },
  { name: "Architecture & Design", technologies: ["AutoCAD", "Revit", "ArchiCAD", "SketchUp", "3ds Max", "Rhino"] },
  { name: "Drafting", technologies: ["AutoCAD", "Revit", "ArchiCAD", "Civil 3D"] },
  { name: "Rendering & Visualization", technologies: ["Lumion", "V-Ray", "Enscape", "Twinmotion", "3ds Max", "Blender"] },
  { name: "Web / Software", technologies: ["React", "Node.js", "Express.js", "MongoDB", "Next.js", "TypeScript", "PostgreSQL"] },
]

async function listWorkCategories(req, res, next) {
  try {
    const rows = await prisma.workCategory.findMany({ where: { organizationId: req.user.organizationId, isActive: true }, orderBy: { name: "asc" } })
    const names = new Set(rows.map(row => row.name.toLowerCase()))
    const defaults = DEFAULTS.filter(item => !names.has(item.name.toLowerCase())).map((item, i) => ({ id: `default-${i}`, organizationId: req.user.organizationId, ...item, isDefault: true }))
    res.json([...rows, ...defaults])
  } catch (err) { next(err) }
}

async function createWorkCategory(req, res, next) {
  try {
    const { name, technologies = [] } = req.body
    const cleanName = String(name || "").trim()
    if (!cleanName) return res.status(400).json({ error: "Work field name is required" })
    const techs = [...new Set((Array.isArray(technologies) ? technologies : []).map(v => String(v).trim()).filter(Boolean))].slice(0, 50)
    const row = await prisma.workCategory.create({ data: { organizationId: req.user.organizationId, name: cleanName, technologies: techs } })
    res.status(201).json(row)
  } catch (err) { next(err) }
}

async function updateWorkCategory(req, res, next) {
  try {
    const existing = await prisma.workCategory.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!existing) return res.status(404).json({ error: "Work field not found" })
    const name = req.body.name === undefined ? existing.name : String(req.body.name).trim()
    const technologies = req.body.technologies === undefined ? existing.technologies : [...new Set((Array.isArray(req.body.technologies) ? req.body.technologies : []).map(v => String(v).trim()).filter(Boolean))].slice(0, 50)
    if (!name) return res.status(400).json({ error: "Work field name is required" })
    const row = await prisma.workCategory.update({ where: { id: existing.id }, data: { name, technologies } })
    res.json(row)
  } catch (err) { next(err) }
}

async function deleteWorkCategory(req, res, next) {
  try {
    const existing = await prisma.workCategory.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } })
    if (!existing) return res.status(404).json({ error: "Work field not found" })
    await prisma.workCategory.update({ where: { id: existing.id }, data: { isActive: false } })
    res.status(204).send()
  } catch (err) { next(err) }
}

module.exports = { listWorkCategories, createWorkCategory, updateWorkCategory, deleteWorkCategory }
