const prisma = require("../lib/prisma")
const { logAudit } = require("../utils/audit")

// Employee document pictures (passport, civil ID, other). Viewing: the
// employee themselves, or ADMIN/CEO/HR. Uploading/removing: ADMIN/CEO/HR —
// and an ADMIN/CEO's documents only by ADMIN/CEO (same rule as editing
// their profile).
const MANAGER_ROLES = ["ADMIN", "CEO", "HR"]
const OWNER_ROLES = ["ADMIN", "CEO"]
const KINDS = ["PASSPORT", "CIVIL_ID", "OTHER"]
const MAX_DOCUMENTS_PER_EMPLOYEE = 30
const META_SELECT = { id: true, kind: true, label: true, fileName: true, mimeType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } }

// The type is taken from the file's own bytes, never the client's claim,
// so nothing scriptable (SVG/HTML) can be stored and served back.
function sniffMime(buf) {
  if (buf.length >= 4 && buf.slice(0, 4).toString("latin1") === "%PDF") return "application/pdf"
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (buf.length >= 12 && buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp"
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString("latin1"))) return "image/gif"
  return null
}

// The target employee, if the requester may see their documents.
async function loadEmployee(req, id) {
  const { organizationId, userId, role } = req.user
  if (id === userId) return prisma.user.findUnique({ where: { id }, select: { id: true, role: true, organizationId: true } })
  if (!MANAGER_ROLES.includes(role)) return null
  return prisma.user.findFirst({ where: { id, organizationId }, select: { id: true, role: true, organizationId: true } })
}

function canManage(req, employee) {
  if (!MANAGER_ROLES.includes(req.user.role)) return false
  if (OWNER_ROLES.includes(employee.role) && !OWNER_ROLES.includes(req.user.role)) return false
  return true
}

async function listDocuments(req, res, next) {
  try {
    const employee = await loadEmployee(req, req.params.id)
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const documents = await prisma.employeeDocument.findMany({ where: { employeeId: employee.id }, orderBy: { createdAt: "asc" }, select: META_SELECT })
    res.json(documents)
  } catch (err) {
    next(err)
  }
}

async function uploadDocument(req, res, next) {
  try {
    const employee = await loadEmployee(req, req.params.id)
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    if (!canManage(req, employee)) {
      return res.status(403).json({ error: OWNER_ROLES.includes(employee.role) ? "Only an Admin or CEO can change an Admin or CEO's documents" : "Only Admin, CEO or HR can upload employee documents" })
    }
    if (!req.file) return res.status(400).json({ error: "Choose a file to upload" })
    const mimeType = sniffMime(req.file.buffer)
    if (!mimeType) return res.status(400).json({ error: "Upload a picture (JPG, PNG, WEBP, GIF) or a PDF" })
    const kind = KINDS.includes(req.body.kind) ? req.body.kind : "OTHER"
    const count = await prisma.employeeDocument.count({ where: { employeeId: employee.id } })
    if (count >= MAX_DOCUMENTS_PER_EMPLOYEE) return res.status(400).json({ error: `An employee can have at most ${MAX_DOCUMENTS_PER_EMPLOYEE} documents` })

    const label = req.body.label ? String(req.body.label).trim().slice(0, 120) || null : null
    const fileName = String(req.file.originalname || "document").replace(/[\\/\r\n"]/g, "_").slice(0, 200)
    const document = await prisma.employeeDocument.create({
      data: {
        organizationId: employee.organizationId,
        employeeId: employee.id,
        kind,
        label,
        fileName,
        mimeType,
        size: req.file.size,
        data: req.file.buffer,
        uploadedById: req.user.userId,
      },
      select: META_SELECT,
    })
    logAudit({ organizationId: employee.organizationId, actorId: req.user.userId, action: "employee.document_uploaded", targetType: "User", targetId: employee.id, note: `${kind}: ${fileName}` })
    res.status(201).json(document)
  } catch (err) {
    next(err)
  }
}

async function downloadDocument(req, res, next) {
  try {
    const employee = await loadEmployee(req, req.params.id)
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    const document = await prisma.employeeDocument.findFirst({ where: { id: req.params.docId, employeeId: employee.id } })
    if (!document) return res.status(404).json({ error: "Document not found" })
    res.setHeader("Content-Type", document.mimeType)
    res.setHeader("Content-Length", document.data.length)
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${document.fileName}"`)
    res.send(Buffer.from(document.data))
  } catch (err) {
    next(err)
  }
}

async function deleteDocument(req, res, next) {
  try {
    const employee = await loadEmployee(req, req.params.id)
    if (!employee) return res.status(404).json({ error: "Employee not found" })
    if (!canManage(req, employee)) return res.status(403).json({ error: "You can't remove this employee's documents" })
    const document = await prisma.employeeDocument.findFirst({ where: { id: req.params.docId, employeeId: employee.id }, select: { id: true, kind: true, fileName: true } })
    if (!document) return res.status(404).json({ error: "Document not found" })
    await prisma.employeeDocument.delete({ where: { id: document.id } })
    logAudit({ organizationId: employee.organizationId, actorId: req.user.userId, action: "employee.document_deleted", targetType: "User", targetId: employee.id, note: `${document.kind}: ${document.fileName}` })
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

module.exports = { listDocuments, uploadDocument, downloadDocument, deleteDocument }
