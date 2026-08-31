// One-off maintenance script: clears out all operational data (assets,
// attendance, tickets, payroll, projects, etc.) while keeping the
// Organization and any ADMIN/CEO accounts intact, so you can still log
// in afterward. Run with: node clean-data.js
// Delete this file once you're done with it — it's not meant to be a
// permanent part of the app.
require("dotenv").config()
const prisma = require("./src/lib/prisma")

async function main() {
  console.log("Clearing operational data (keeping Organization + ADMIN/CEO accounts)...")

  // Children first, in FK-safe order.
  await prisma.lifecycleEvent.deleteMany({})
  await prisma.ticket.deleteMany({})
  await prisma.assetRequest.deleteMany({})
  await prisma.leaveApplication.deleteMany({})
  await prisma.attendanceRecord.deleteMany({})
  await prisma.payrollRecord.deleteMany({})
  await prisma.projectMember.deleteMany({})
  await prisma.project.deleteMany({})
  await prisma.asset.deleteMany({})
  await prisma.biometricPunch.deleteMany({})
  await prisma.biometricDeviceEmployee.deleteMany({})
  await prisma.biometricDevice.deleteMany({})
  await prisma.holiday.deleteMany({})
  await prisma.announcement.deleteMany({})
  await prisma.auditLog.deleteMany({})

  // Detach manager links before removing the employees themselves.
  await prisma.user.updateMany({
    where: { role: { notIn: ["ADMIN", "CEO"] } },
    data: { managerId: null },
  })
  const removedEmployees = await prisma.user.deleteMany({
    where: { role: { notIn: ["ADMIN", "CEO"] } },
  })

  await prisma.department.deleteMany({})

  console.log(`Done. Removed ${removedEmployees.count} employee account(s); Organization and ADMIN/CEO logins were kept.`)
}

main()
  .catch((err) => {
    console.error("Failed:", err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())