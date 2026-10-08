// Creates (or resets the password of) the ONE ManagementDock platform account.
// It lives in its own hidden "ManagementDock Platform" organization, so it
// belongs to no customer company, appears in no company's lists, and is the
// only kind of account that can open the Control Center.
//
//   cd backend
//   PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='long password' node scripts/create-platform-admin.js
//
// Run `npx prisma migrate deploy && npx prisma generate` first (it adds the
// PLATFORM_ADMIN role). Safe to re-run: it only updates the password/role.
require("dotenv").config()
const bcrypt = require("bcrypt")
const crypto = require("crypto")
const prisma = require("../src/lib/prisma")
const { PLATFORM_ORG_SLUG } = require("../src/utils/platform")

async function main() {
  const email = String(process.env.PLATFORM_ADMIN_EMAIL || "").trim().toLowerCase()
  const password = String(process.env.PLATFORM_ADMIN_PASSWORD || "")
  if (!email || password.length < 12) {
    throw new Error("Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD (at least 12 characters)")
  }
  const hashed = await bcrypt.hash(password, 10)

  let org = await prisma.organization.findUnique({ where: { slug: PLATFORM_ORG_SLUG } })
  if (!org) {
    const id = crypto.randomUUID()
    org = await prisma.organization.create({ data: { id, name: "ManagementDock Platform", slug: PLATFORM_ORG_SLUG, companyId: id } })
    console.log("Created the platform organization")
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing && existing.organizationId !== org.id) {
    throw new Error(`${email} already belongs to a customer company. Use a different email for the platform account.`)
  }
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { password: hashed, role: "PLATFORM_ADMIN", status: "ACTIVE" } })
    console.log(`Updated platform account ${email}`)
  } else {
    await prisma.user.create({ data: { organizationId: org.id, name: "ManagementDock Platform", email, password: hashed, role: "PLATFORM_ADMIN" } })
    console.log(`Created platform account ${email}`)
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
