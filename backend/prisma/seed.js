require("dotenv").config()
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcrypt")
const { encryptField } = require("../src/utils/crypto")

const prisma = new PrismaClient()

function today() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function main() {
  const hashed = await bcrypt.hash("password123", 10)

  const org = await prisma.organization.create({
    data: {
      name: "Acme Corp",
      slug: "acme-corp",
      primaryColor: "#3E63DD",
      accentColor: "#16A34A",
      theme: "light",
      planTier: "BUSINESS",
    },
  })

  const engineering = await prisma.department.create({
    data: { organizationId: org.id, name: "Engineering" },
  })
  const sales = await prisma.department.create({
    data: { organizationId: org.id, name: "Sales" },
  })

  // Three designated admins — the only accounts with attendance access.
  const [admin1, admin2, admin3] = await Promise.all([
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "admin1",
        email: "admin1@acme.test",
        password: hashed,
        role: "ADMIN",
        departmentId: engineering.id,
        canManageAttendance: true,
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "admin2",
        email: "admin2@acme.test",
        password: hashed,
        role: "ADMIN",
        departmentId: engineering.id,
        canManageAttendance: true,
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "admin3",
        email: "admin3@acme.test",
        password: hashed,
        role: "ADMIN",
        departmentId: sales.id,
        canManageAttendance: true,
      },
    }),
  ])

  const ali = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Ali Raza",
      email: "ali@acme.test",
      password: hashed,
      role: "EMPLOYEE",
      departmentId: engineering.id,
      managerId: admin1.id,
      skill: "Frontend Development",
      seniorityLevel: "SENIOR",
      address: "Lahore, Punjab",
      dob: new Date("1994-03-12"),
      cnic: encryptField("35202-1234567-1"),
    },
  })

  const sarah = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Sarah Ahmed",
      email: "sarah@acme.test",
      password: hashed,
      role: "EMPLOYEE",
      departmentId: sales.id,
      managerId: admin3.id,
      skill: "Enterprise Sales",
      seniorityLevel: "JUNIOR",
      address: "Karachi, Sindh",
      dob: new Date("1998-07-22"),
      cnic: encryptField("42101-7654321-2"),
    },
  })

  const danish = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Danish Malik",
      email: "danish@acme.test",
      password: hashed,
      role: "EMPLOYEE",
      departmentId: engineering.id,
      managerId: admin1.id,
      skill: "Backend Development",
      seniorityLevel: "INTERN",
      address: "Islamabad",
      dob: new Date("2002-11-05"),
      cnic: encryptField("61101-1122334-5"),
    },
  })

  const laptop = await prisma.asset.create({
    data: {
      organizationId: org.id,
      name: "Dell Latitude 7440",
      category: "Laptop",
      serialNumber: "DL7440-0001",
      cpu: "Intel Core i7-1355U",
      ram: "16GB",
      storage: "512GB SSD",
      purchaseDate: new Date("2023-02-10"),
      warrantyEnd: new Date("2026-09-01"),
      departmentId: engineering.id,
      status: "ASSIGNED",
      assignedToId: ali.id,
    },
  })

  await prisma.lifecycleEvent.createMany({
    data: [
      { assetId: laptop.id, type: "PURCHASED", actorId: admin1.id, occurredAt: new Date("2023-02-10") },
      { assetId: laptop.id, type: "ASSIGNED", actorId: admin1.id, note: "Assigned to Ali", occurredAt: new Date("2023-02-15") },
      { assetId: laptop.id, type: "REPAIR_STARTED", actorId: admin1.id, note: "Battery replacement", occurredAt: new Date("2026-06-10") },
      { assetId: laptop.id, type: "RETURNED", actorId: admin1.id, note: "Returned from repair", occurredAt: new Date("2026-07-05") },
      { assetId: laptop.id, type: "UPGRADED", actorId: admin1.id, note: "RAM upgraded to 16GB", occurredAt: new Date("2024-05-01") },
    ],
  })

  await prisma.asset.create({
    data: {
      organizationId: org.id,
      name: 'MacBook Pro 14"',
      category: "Laptop",
      serialNumber: "MBP14-0002",
      cpu: "Apple M3 Pro",
      ram: "18GB",
      storage: "1TB SSD",
      purchaseDate: new Date("2024-06-01"),
      warrantyEnd: new Date("2027-06-01"),
      departmentId: sales.id,
      status: "AVAILABLE",
      lifecycleEvents: {
        create: [
          { type: "PURCHASED", actorId: admin1.id, occurredAt: new Date("2024-06-01") },
          { type: "ASSIGNED", actorId: admin1.id, note: "Assigned to Sarah", occurredAt: new Date("2026-07-20") },
          { type: "RETURNED", actorId: admin1.id, note: "Returned by Sarah", occurredAt: new Date("2026-08-05") },
        ],
      },
    },
  })

  await prisma.asset.create({
    data: {
      organizationId: org.id,
      name: "ThinkPad X1 Carbon",
      category: "Laptop",
      serialNumber: "TPX1C-0003",
      cpu: "Intel Core i5-1345U",
      ram: "16GB",
      storage: "512GB SSD",
      purchaseDate: new Date("2024-01-15"),
      warrantyEnd: new Date("2027-01-15"),
      departmentId: engineering.id,
      status: "ASSIGNED",
      assignedToId: danish.id,
      lifecycleEvents: {
        create: [
          { type: "PURCHASED", actorId: admin1.id, occurredAt: new Date("2024-01-15") },
          { type: "ASSIGNED", actorId: admin1.id, note: "Assigned to Danish", occurredAt: new Date("2024-01-20") },
        ],
      },
    },
  })

  await prisma.ticket.create({
    data: {
      organizationId: org.id,
      subject: "Laptop battery lasts only 30 minutes",
      description: "The battery on my Dell Latitude drains very fast after the last update.",
      priority: "HIGH",
      status: "OPEN",
      raisedById: ali.id,
      assetId: laptop.id,
    },
  })

  // A couple of non-laptop assets so the Accessories/Stationery category
  // filters have something to show out of the box.
  await prisma.asset.createMany({
    data: [
      {
        organizationId: org.id,
        name: "Logitech MX Keys Keyboard",
        category: "Accessories",
        serialNumber: "ACC-KB-0001",
        status: "AVAILABLE",
      },
      {
        organizationId: org.id,
        name: "Logitech MX Master 3 Mouse",
        category: "Accessories",
        serialNumber: "ACC-MS-0002",
        status: "AVAILABLE",
      },
      {
        organizationId: org.id,
        name: "Jabra Evolve2 Headset",
        category: "Accessories",
        serialNumber: "ACC-HS-0003",
        status: "AVAILABLE",
      },
      {
        organizationId: org.id,
        name: "A5 Notepad (pack of 5)",
        category: "Stationery",
        serialNumber: "STA-NP-0001",
        status: "AVAILABLE",
      },
      {
        organizationId: org.id,
        name: "Ballpoint Pens (box of 12)",
        category: "Stationery",
        serialNumber: "STA-PEN-0002",
        status: "AVAILABLE",
      },
    ],
  })

  // Sample attendance for today
  await prisma.attendanceRecord.createMany({
    data: [
      {
        organizationId: org.id,
        employeeId: ali.id,
        date: today(),
        status: "PRESENT",
        markedById: admin1.id,
        createdAt: new Date("2026-08-10T09:15:00Z"),
        updatedAt: new Date("2026-08-10T09:15:00Z"),
      },
      {
        organizationId: org.id,
        employeeId: sarah.id,
        date: today(),
        status: "ABSENT",
        markedById: admin1.id,
        createdAt: new Date("2026-08-10T09:00:00Z"),
        updatedAt: new Date("2026-08-10T09:00:00Z"),
      },
      {
        organizationId: org.id,
        employeeId: danish.id,
        date: today(),
        status: "PRESENT",
        markedById: admin1.id,
        createdAt: new Date("2026-08-10T09:30:00Z"),
        updatedAt: new Date("2026-08-10T09:30:00Z"),
      },
    ],
  })

  // Management roles alongside the Owner (ADMIN) — CEO, Sales Head, HR.
  const [ceo, salesHead, hr] = await Promise.all([
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Imran Qureshi",
        email: "ceo@acme.test",
        password: hashed,
        role: "CEO",
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Bilal Farooq",
        email: "saleshead@acme.test",
        password: hashed,
        role: "SALES_HEAD",
        departmentId: sales.id,
      },
    }),
    prisma.user.create({
      data: {
        organizationId: org.id,
        name: "Ayesha Noor",
        email: "hr@acme.test",
        password: hashed,
        role: "HR",
      },
    }),
  ])

  // A sample pending leave application for the leave-review demo.
  await prisma.leaveApplication.create({
    data: {
      organizationId: org.id,
      employeeId: sarah.id,
      startDate: today(),
      endDate: today(),
      reason: "Family event out of town.",
      type: "CASUAL",
      status: "PENDING",
    },
  })

  // A couple of sample public holidays so the leave calendar isn't empty.
  const thisYear = new Date().getFullYear()
  await prisma.holiday.createMany({
    data: [
      { organizationId: org.id, date: new Date(Date.UTC(thisYear, 0, 1)), name: "New Year's Day" },
      { organizationId: org.id, date: new Date(Date.UTC(thisYear, 7, 14)), name: "Independence Day" },
    ],
    skipDuplicates: true,
  })

  console.log("Seed complete.")
  console.log("Attendance admins: admin1@acme.test / admin2@acme.test / admin3@acme.test — password123")
  console.log("Management: ceo@acme.test / saleshead@acme.test / hr@acme.test — password123")
  console.log("Employees: ali@acme.test / sarah@acme.test / danish@acme.test — password123")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
