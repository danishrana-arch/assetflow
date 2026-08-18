// One-off migration: encrypts any CNIC values that are still stored in
// plaintext from before field-level encryption was added. Safe to run
// more than once — already-encrypted values (format "iv:authTag:cipher",
// all hex) are detected and skipped.
//
// Usage:  node scripts/encrypt-existing-cnic.js

require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const { encryptField } = require("../src/utils/crypto")

const prisma = new PrismaClient()

const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i

async function main() {
  const users = await prisma.user.findMany({
    where: { cnic: { not: null } },
    select: { id: true, cnic: true },
  })

  let updated = 0
  for (const user of users) {
    if (!user.cnic || ENCRYPTED_FORMAT.test(user.cnic)) continue // already encrypted or empty
    await prisma.user.update({
      where: { id: user.id },
      data: { cnic: encryptField(user.cnic) },
    })
    updated += 1
  }

  console.log(`Done. Encrypted ${updated} of ${users.length} CNIC value(s) that were still plaintext.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
