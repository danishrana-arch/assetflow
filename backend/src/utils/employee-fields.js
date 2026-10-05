const { encryptField, decryptField } = require("./crypto")

// Employee fields added for identification / emergency contact / dates.
// Shared by manual add (auth.controller inviteEmployee), profile edit
// (employee.controller updateEmployee) and sheet import, so all three write
// the same columns the same way.

// Stored encrypted at rest, like CNIC.
const ENCRYPTED_DETAIL_FIELDS = ["passportNumber", "civilNumber", "emergencyContactPhone", "emergencyContactAltPhone", "emergencyContactAddress"]
const PLAIN_DETAIL_FIELDS = ["nationality", "agentName", "emergencyContactName", "emergencyContactRelationship", "emergencyContactNotes"]
const DETAIL_FIELDS = [...ENCRYPTED_DETAIL_FIELDS, ...PLAIN_DETAIL_FIELDS]
const EMPLOYMENT_STATUSES = ["PROBATION", "PERMANENT"]

function cleanText(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s === "" ? null : s.slice(0, 500)
}

// YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (day first, as used in
// Pakistan/the Gulf), or anything Date can parse ("15 Jan 2026"). Returns a
// UTC-midnight Date, null for blank, or undefined when it can't be read.
function parseDateInput(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
  const s = String(value).trim()
  if (!s) return null
  let y, m, d
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (match) [, y, m, d] = match.map(Number)
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = match.map(Number)
  else {
    const parsed = new Date(s)
    if (Number.isNaN(parsed.getTime())) return undefined
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined
  return date
}

// "09:00", "9:00", "9:00 AM", "5 pm" → "HH:mm"; null for blank; undefined if unreadable.
function normalizeShiftTime(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  if (!s) return null
  const match = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s)
  if (!match) return undefined
  let hours = Number(match[1])
  const minutes = Number(match[2] || 0)
  if (match[3]) {
    if (hours < 1 || hours > 12) return undefined
    hours = (hours % 12) + (match[3] === "pm" ? 12 : 0)
  }
  if (hours > 23 || minutes > 59) return undefined
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

// "Permanent", "permanent employee", "confirmed" → PERMANENT; "Probation",
// "on probation" → PROBATION; null for blank; undefined if unreadable.
function parseEmploymentStatus(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  if (!s) return null
  if (s.includes("perm") || s === "confirmed") return "PERMANENT"
  if (s.includes("probation")) return "PROBATION"
  return undefined
}

// The detail fields from `source` (only keys present), ready for Prisma.
function detailFieldData(source, fields = DETAIL_FIELDS) {
  const data = {}
  for (const field of fields) {
    if (source[field] === undefined) continue
    const value = cleanText(source[field])
    data[field] = ENCRYPTED_DETAIL_FIELDS.includes(field) ? (value ? encryptField(value) : null) : value
  }
  return data
}

// Employment status + permanent date, kept consistent: PERMANENT always has
// a permanent date (today if none given), PROBATION has none.
function employmentData({ employmentStatus, permanentDate }, existing = {}) {
  const status = employmentStatus ?? existing.employmentStatus ?? "PROBATION"
  let date = permanentDate !== undefined ? permanentDate : existing.permanentDate ?? null
  if (status === "PROBATION") date = null
  else if (!date) {
    const now = new Date()
    date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  }
  return { employmentStatus: status, permanentDate: date }
}

function decryptDetailFields(user) {
  const out = {}
  for (const field of ENCRYPTED_DETAIL_FIELDS) if (field in user) out[field] = decryptField(user[field])
  return out
}

// Removes every sensitive detail field (list responses / unauthorized viewers).
function omitDetailFields(user) {
  const copy = { ...user }
  for (const field of ENCRYPTED_DETAIL_FIELDS) delete copy[field]
  delete copy.emergencyContactName
  delete copy.emergencyContactRelationship
  delete copy.emergencyContactNotes
  return copy
}

module.exports = {
  ENCRYPTED_DETAIL_FIELDS,
  PLAIN_DETAIL_FIELDS,
  DETAIL_FIELDS,
  EMPLOYMENT_STATUSES,
  cleanText,
  parseDateInput,
  normalizeShiftTime,
  parseEmploymentStatus,
  detailFieldData,
  employmentData,
  decryptDetailFields,
  omitDetailFields,
}
