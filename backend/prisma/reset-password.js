const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcrypt")

const prisma = new PrismaClient()

async function main() {
  const [, , email, newPassword] = process.argv

  if (!email || !newPassword) {
    console.error("Usage: node prisma/reset-password.js <email> <newPassword>")
    process.exit(1)
  }

  const hashed = await bcrypt.hash(newPassword, 10)

  const user = await prisma.user.update({
    where: { email },
    data: { password: hashed },
  })

  console.log(`Password reset for ${user.email}. You can now log in with the new password.`)
}

main()
  .catch((e) => {
    console.error("Failed:", e.message)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
