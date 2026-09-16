// One-off migration: encrypts phone, address, personalEmail and fatherName
// values that are still stored in plaintext from before field-level
// encryption was extended to cover them (cnic/bankAccountNumber were
// already handled by encrypt-existing-cnic.js). Safe to run more than
// once — already-encrypted values (format "iv:authTag:cipher", all hex)
// are detected and skipped.
//
// Usage:  node scripts/encrypt-existing-pii.js

require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const { encryptField } = require("../src/utils/crypto")

const prisma = new PrismaClient()

const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i
const FIELDS = ["phone", "address", "personalEmail", "fatherName"]

function needsEncryption(value) {
  return value !== null && value !== undefined && value !== "" && !ENCRYPTED_FORMAT.test(value)
}

async function migrateUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, phone: true, address: true, personalEmail: true, fatherName: true },
  })

  let updated = 0
  for (const user of users) {
    const data = {}
    for (const field of FIELDS) {
      if (needsEncryption(user[field])) data[field] = encryptField(user[field])
    }
    if (Object.keys(data).length === 0) continue
    await prisma.user.update({ where: { id: user.id }, data })
    updated += 1
  }
  console.log(`User: encrypted PII on ${updated} of ${users.length} row(s).`)
}

async function migrateEmployeeFormSubmissions() {
  const submissions = await prisma.employeeFormSubmission.findMany({
    select: { id: true, phone: true, address: true, personalEmail: true, fatherName: true },
  })

  let updated = 0
  for (const submission of submissions) {
    const data = {}
    for (const field of FIELDS) {
      if (needsEncryption(submission[field])) data[field] = encryptField(submission[field])
    }
    if (Object.keys(data).length === 0) continue
    await prisma.employeeFormSubmission.update({ where: { id: submission.id }, data })
    updated += 1
  }
  console.log(`EmployeeFormSubmission: encrypted PII on ${updated} of ${submissions.length} row(s).`)
}

async function main() {
  await migrateUsers()
  await migrateEmployeeFormSubmissions()
  console.log("Done.")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
