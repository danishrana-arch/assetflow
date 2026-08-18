const ExcelJS = require("exceljs")
const prisma = require("../lib/prisma")

async function sendWorkbook(res, filename, sheetName, columns, rows) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns
  rows.forEach((row) => sheet.addRow(row))
  sheet.getRow(1).font = { bold: true }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  res.setHeader("Content-Disposition", `attachment filename="${filename}"`)
  await workbook.xlsx.write(res)
  res.end()
}

async function exportEmployees(req, res, next) {
  try {
    const { organizationId } = req.user
    const employees = await prisma.user.findMany({
      where: { organizationId },
      include: { department: true },
    })

    await sendWorkbook(
      res,
      "Employees.xlsx",
      "Employees",
      [
        { header: "Name", key: "name", width: 24 },
        { header: "Email", key: "email", width: 28 },
        { header: "Department", key: "department", width: 20 },
        { header: "Status", key: "status", width: 14 },
        { header: "Phone", key: "phone", width: 16 },
      ],
      employees.map((e) => ({
        name: e.name,
        email: e.email,
        department: e.department?.name || "",
        status: e.status,
        phone: e.phone || "",
      }))
    )
  } catch (err) {
    next(err)
  }
}

async function exportInventory(req, res, next) {
  try {
    const { organizationId } = req.user
    const assets = await prisma.asset.findMany({
      where: { organizationId },
      include: { assignedTo: true, department: true },
    })

    await sendWorkbook(
      res,
      "Inventory.xlsx",
      "Inventory",
      [
        { header: "Name", key: "name", width: 26 },
        { header: "Serial Number", key: "serialNumber", width: 20 },
        { header: "Category", key: "category", width: 16 },
        { header: "Status", key: "status", width: 14 },
        { header: "Assigned To", key: "assignedTo", width: 22 },
        { header: "Department", key: "department", width: 20 },
        { header: "Warranty End", key: "warrantyEnd", width: 16 },
      ],
      assets.map((a) => ({
        name: a.name,
        serialNumber: a.serialNumber,
        category: a.category || "",
        status: a.status,
        assignedTo: a.assignedTo?.name || "",
        department: a.department?.name || "",
        warrantyEnd: a.warrantyEnd ? a.warrantyEnd.toISOString().slice(0, 10) : "",
      }))
    )
  } catch (err) {
    next(err)
  }
}

async function exportDepartments(req, res, next) {
  try {
    const { organizationId } = req.user
    const departments = await prisma.department.findMany({
      where: { organizationId },
      include: { _count: { select: { employees: true, assets: true } } },
    })

    await sendWorkbook(
      res,
      "Departments.xlsx",
      "Departments",
      [
        { header: "Name", key: "name", width: 24 },
        { header: "Employees", key: "employees", width: 14 },
        { header: "Assets", key: "assets", width: 12 },
      ],
      departments.map((d) => ({ name: d.name, employees: d._count.employees, assets: d._count.assets }))
    )
  } catch (err) {
    next(err)
  }
}

async function exportTickets(req, res, next) {
  try {
    const { organizationId } = req.user
    const tickets = await prisma.ticket.findMany({
      where: { organizationId },
      include: { raisedBy: true, asset: true },
    })

    await sendWorkbook(
      res,
      "Tickets.xlsx",
      "Tickets",
      [
        { header: "Subject", key: "subject", width: 30 },
        { header: "Priority", key: "priority", width: 12 },
        { header: "Status", key: "status", width: 14 },
        { header: "Raised By", key: "raisedBy", width: 22 },
        { header: "Asset", key: "asset", width: 24 },
        { header: "Created", key: "createdAt", width: 16 },
      ],
      tickets.map((t) => ({
        subject: t.subject,
        priority: t.priority,
        status: t.status,
        raisedBy: t.raisedBy?.name || "",
        asset: t.asset?.name || "",
        createdAt: t.createdAt.toISOString().slice(0, 10),
      }))
    )
  } catch (err) {
    next(err)
  }
}

module.exports = { exportEmployees, exportInventory, exportDepartments, exportTickets }
