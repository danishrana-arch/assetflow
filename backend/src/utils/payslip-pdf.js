const PDFDocument = require("pdfkit")

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

const STATUS_LABEL = { DRAFT: "Draft", PENDING_APPROVAL: "Pending approval", PAID: "Paid" }

// pdfkit's built-in Helvetica only covers WinAnsi, so stick to ASCII here
// (plain "-" rather than a real minus sign, etc.).
function money(n) {
  return `PKR ${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatDate(value, timeZone = "UTC") {
  if (!value) return "-"
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone })
}

function maskAccount(decrypted) {
  if (!decrypted) return "-"
  const s = String(decrypted)
  return s.length > 4 ? `**** ${s.slice(-4)}` : "****"
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

function safeColor(hex) {
  return /^#[0-9a-f]{6}$/i.test(hex || "") ? hex : "#3E63DD"
}

// Streams a one-page A4 payslip PDF for `record` into `res`.
// `employee`: { name, email, designation, department: { name }, joiningDate }
// `organization`: { name, primaryColor, timezone }
// `bankAccount`: already decrypted account number (only its last 4 digits are printed).
function streamPayslipPdf(res, { record, employee, organization, bankAccount }) {
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: "Payslip", Author: organization.name } })
  doc.pipe(res)

  const W = doc.page.width
  const H = doc.page.height
  const M = 40
  const inner = W - M * 2
  const brand = safeColor(organization.primaryColor)
  const ink = "#1F2430"
  const muted = "#6B7280"
  const line = "#E5E7EB"
  const green = "#15803D"
  const red = "#B91C1C"
  const period = `${MONTHS[record.month - 1]} ${record.year}`

  // Header band
  doc.rect(0, 0, W, 96).fill(brand)
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(22).text(organization.name, M, 30, { width: inner * 0.62, lineBreak: false, ellipsis: true })
  doc.font("Helvetica").fontSize(10).text("Salary slip", M, 60)
  doc.font("Helvetica-Bold").fontSize(20).text("PAYSLIP", M, 28, { width: inner, align: "right" })
  doc.font("Helvetica").fontSize(10).text(period, M, 56, { width: inner, align: "right" })

  // Deposit disclaimer banner
  let y = 112
  doc.rect(M, y, inner, 30).fillAndStroke("#FEF2F2", "#FCA5A5")
  doc.fillColor(red).font("Helvetica-Bold").fontSize(9.5).text(
    "FOR EMPLOYEE RECORDS ONLY - THIS IS NOT A CHEQUE AND CANNOT BE DEPOSITED OR ENCASHED",
    M, y + 10, { width: inner, align: "center" }
  )

  // Employee / period details
  y += 46
  const details = [
    ["Employee", employee.name],
    ["Pay period", period],
    ["Designation", employee.designation || "-"],
    ["Status", STATUS_LABEL[record.status] || record.status],
    ["Department", employee.department?.name || "-"],
    ["Payment date", record.paidAt ? formatDate(record.paidAt, organization.timezone) : "Not yet paid"],
    ["Email", employee.email],
    ["Bank account", record.bankName ? `${record.bankName} ${maskAccount(bankAccount)}` : maskAccount(bankAccount)],
    ["Joining date", formatDate(employee.joiningDate)],
    ["Payslip ref.", record.id.slice(-10).toUpperCase()],
  ]
  const colW = inner / 2
  details.forEach(([label, value], i) => {
    const x = M + (i % 2) * colW
    const rowY = y + Math.floor(i / 2) * 20
    doc.fillColor(muted).font("Helvetica").fontSize(8.5).text(label.toUpperCase(), x, rowY, { width: 90 })
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9.5).text(String(value), x + 92, rowY - 1, { width: colW - 100, lineBreak: false, ellipsis: true })
  })
  y += Math.ceil(details.length / 2) * 20 + 10

  if (record.terminationDate) {
    doc.rect(M, y, inner, record.terminationNote ? 36 : 22).fill("#FFF7ED")
    doc.fillColor("#C2410C").font("Helvetica-Bold").fontSize(9).text(`FINAL SETTLEMENT - employment ended ${formatDate(record.terminationDate)}`, M + 10, y + 7, { width: inner - 20 })
    if (record.terminationNote) doc.font("Helvetica").fontSize(8.5).text(record.terminationNote, M + 10, y + 20, { width: inner - 20, lineBreak: false, ellipsis: true })
    y += (record.terminationNote ? 36 : 22) + 10
  }

  // Earnings / deductions tables
  const leaveDetail = [
    record.absentDays ? `${plural(record.absentDays, "day")} absent` : null,
    record.unpaidLeaveDays ? `${plural(record.unpaidLeaveDays, "day")} unpaid leave` : null,
    record.halfDayLeaveDays ? plural(record.halfDayLeaveDays, "half-day") : null,
  ].filter(Boolean).join(", ")
  const taxPct = Number(record.taxPercent || 0)

  const earnings = [
    ["Basic pay", record.baseSalary],
    ["Bonus", record.bonus],
    ...(Number(record.performanceBonus) > 0 ? [["Performance bonus", record.performanceBonus]] : []),
    ["Office expenses (reimbursed)", record.expenseReimbursement],
    ...(Number(record.terminationSettlement) > 0 ? [["Termination settlement", record.terminationSettlement]] : []),
  ]
  const deductions = [
    [taxPct ? `Tax (${taxPct}%)` : "Tax", record.tax],
    [leaveDetail ? `Absent (${leaveDetail})` : "Absent", record.absentDeduction],
    [record.lateDays ? `Late (${plural(record.lateDays, "day")})` : "Late", record.lateDeduction],
    ...(Number(record.fineDeduction) > 0 ? [["Attendance fines", record.fineDeduction]] : []),
    ...(Number(record.otherDeduction) > 0 ? [["Other deductions", record.otherDeduction]] : []),
    ...(Number(record.terminationDeduction) > 0 ? [["Termination deduction", record.terminationDeduction]] : []),
  ]
  const totalEarnings = earnings.reduce((s, [, v]) => s + Number(v || 0), 0)
  const totalDeductions = Number(record.deductions || 0)

  const gap = 16
  const tableW = (inner - gap) / 2
  const rows = Math.max(earnings.length, deductions.length)
  const rowH = 22

  function table(x, title, items, total, color) {
    doc.rect(x, y, tableW, 24).fill("#F3F4F6")
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9.5).text(title, x + 10, y + 8)
    doc.text("Amount", x, y + 8, { width: tableW - 10, align: "right" })
    let ry = y + 24
    for (let i = 0; i < rows; i += 1) {
      const item = items[i]
      if (item) {
        doc.fillColor(ink).font("Helvetica").fontSize(9).text(item[0], x + 10, ry + 7, { width: tableW - 120, lineBreak: false, ellipsis: true })
        doc.fillColor(color).font("Helvetica").text(money(item[1]), x, ry + 7, { width: tableW - 10, align: "right" })
      }
      ry += rowH
      doc.moveTo(x, ry).lineTo(x + tableW, ry).lineWidth(0.5).strokeColor(line).stroke()
    }
    doc.rect(x, ry, tableW, 26).fill("#F9FAFB")
    doc.fillColor(ink).font("Helvetica-Bold").fontSize(9.5).text(`Total ${title.toLowerCase()}`, x + 10, ry + 9)
    doc.fillColor(color).text(money(total), x, ry + 9, { width: tableW - 10, align: "right" })
    doc.rect(x, y, tableW, ry + 26 - y).lineWidth(0.8).strokeColor(line).stroke()
  }

  table(M, "Earnings", earnings, totalEarnings, green)
  table(M + tableW + gap, "Deductions", deductions, totalDeductions, red)
  y += 24 + rows * rowH + 26 + 18

  // Net pay
  doc.rect(M, y, inner, 50).fill(brand)
  doc.fillColor("#FFFFFF").font("Helvetica").fontSize(10).text("NET PAY", M + 16, y + 12)
  doc.fontSize(8.5).text("Total earnings - total deductions", M + 16, y + 28)
  doc.font("Helvetica-Bold").fontSize(20).text(money(record.netPay), M, y + 15, { width: inner - 16, align: "right" })
  y += 50 + 14

  if (record.note) {
    doc.fillColor(muted).font("Helvetica-Oblique").fontSize(8.5).text(`Note: ${record.note}`, M, y, { width: inner })
    y = doc.y + 10
  }

  if (record.status !== "PAID") {
    doc.fillColor("#A16207").font("Helvetica-Bold").fontSize(9).text(
      "This payslip is not final - payroll for this month has not been approved and paid yet.",
      M, y, { width: inner }
    )
  }

  // Footer — drop the bottom margin first, or text this low would make
  // pdfkit start a new page.
  doc.page.margins.bottom = 0
  const fy = H - 100
  doc.moveTo(M, fy).lineTo(W - M, fy).lineWidth(0.5).strokeColor(line).stroke()
  doc.fillColor(muted).font("Helvetica").fontSize(8).text(
    "This payslip is a computer-generated statement of earnings for the employee's personal records and does not require a signature. " +
      "It is NOT a cheque, bank draft, payment order or negotiable instrument and must not be presented to any bank for deposit or encashment. " +
      "Salary is paid only by direct bank transfer from the company.",
    M, fy + 8, { width: inner, align: "center" }
  )
  doc.text(`Generated ${formatDate(new Date(), organization.timezone)} - ${organization.name} - Confidential`, M, fy + 48, { width: inner, align: "center", lineBreak: false })

  // Big diagonal watermark, drawn last and translucent so it shows across
  // the tables and net-pay box too.
  doc.save()
  doc.rotate(-38, { origin: [W / 2, H / 2] })
  doc.fillColor(red).fillOpacity(0.13).font("Helvetica-Bold").fontSize(60)
  doc.text("NOT VALID FOR", -100, H / 2 - 80, { width: W + 200, align: "center", lineBreak: false })
  doc.text("BANK DEPOSIT", -100, H / 2 - 8, { width: W + 200, align: "center", lineBreak: false })
  doc.restore()

  doc.end()
}

module.exports = { streamPayslipPdf }
