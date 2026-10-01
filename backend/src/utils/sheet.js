// Reads an uploaded spreadsheet into rows of trimmed strings, whatever it was
// saved as: CSV (comma / semicolon / tab, auto-detected), TSV, or Excel
// .xlsx / .xlsm — which also covers Google Sheets ("Download → .xlsx/.csv")
// and Numbers/LibreOffice exports in those formats. Used by the employee and
// asset bulk imports.
const ExcelJS = require("exceljs")
const { parseCsv } = require("./csv")

const ACCEPTED_EXTENSIONS = /\.(csv|tsv|txt|xlsx|xlsm)$/i
const ACCEPTED_LABEL = ".xlsx, .xlsm, .csv or .tsv"

class SheetError extends Error {}

function isAcceptedSheet(file) {
  return ACCEPTED_EXTENSIONS.test(file.originalname || "") ||
    /csv|tab-separated|spreadsheetml|ms-excel\.sheet\.macroenabled/.test(file.mimetype || "")
}

// multer fileFilter rejection → a 400 with a readable message (error.middleware uses err.status).
function sheetTypeError() {
  const err = new Error(`Unsupported file type — upload a spreadsheet saved as ${ACCEPTED_LABEL} (old .xls/.ods: "Save As" .xlsx first)`)
  err.status = 400
  return err
}

function cellText(value) {
  if (value == null) return ""
  if (value instanceof Date) {
    // Excel dates come back as UTC midnight; keep just the calendar date.
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10)
  }
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((p) => p.text).join("")
    if (value.text !== undefined) return cellText(value.text) // hyperlink
    if (value.result !== undefined) return cellText(value.result) // formula
    if (value.error) return ""
    return String(value)
  }
  return String(value)
}

async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  // First sheet that actually has data (skips an empty "Sheet1" cover tab).
  const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0)
  if (!sheet) return []
  const rows = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = []
    for (let c = 1; c <= row.cellCount; c++) values.push(cellText(row.getCell(c).value).trim())
    if (values.some((v) => v !== "")) rows.push(values)
  })
  return rows
}

function readDelimited(buffer) {
  const text = buffer.toString("utf8").replace(/^﻿/, "")
  const firstLine = text.split(/\r?\n/, 1)[0] || ""
  const count = (ch) => firstLine.split(ch).length - 1
  const delimiter = [["\t", count("\t")], [";", count(";")], [",", count(",")]]
    .sort((a, b) => b[1] - a[1])[0]
  return parseCsv(text, delimiter[1] > 0 ? delimiter[0] : ",")
}

async function readSheet(file) {
  const buf = file.buffer
  const name = (file.originalname || "").toLowerCase()
  // Old binary Excel (.xls) and OpenDocument (.ods) can't be read here.
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) {
    throw new SheetError(`Old Excel .xls files aren't supported — open it and "Save As" ${ACCEPTED_LABEL}`)
  }
  if (name.endsWith(".ods")) throw new SheetError(`.ods files aren't supported — save it as ${ACCEPTED_LABEL}`)
  const isZip = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b
  if (isZip) {
    try {
      return await readXlsx(buf)
    } catch {
      throw new SheetError(`Couldn't read that Excel file — save it again as ${ACCEPTED_LABEL}`)
    }
  }
  return readDelimited(buf)
}

// Header matching that tolerates how people actually title columns:
// "Full Name", "E-mail Address", "Serial No." all resolve. `aliases` maps a
// column key to extra accepted spellings (the key itself is always accepted).
function normalizeHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function mapHeaders(headerRow, columns, aliases = {}) {
  const lookup = new Map()
  for (const col of columns) {
    for (const name of [col, ...(aliases[col] || [])]) lookup.set(normalizeHeader(name), col)
  }
  const map = {}
  headerRow.forEach((cell, index) => {
    const col = lookup.get(normalizeHeader(cell))
    if (col && map[col] === undefined) map[col] = index
  })
  return map
}

module.exports = { readSheet, mapHeaders, isAcceptedSheet, sheetTypeError, SheetError, ACCEPTED_LABEL }
