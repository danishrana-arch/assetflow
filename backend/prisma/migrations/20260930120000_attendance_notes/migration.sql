-- HR/ADMIN/CEO notes on an employee's attendance day (Attendance page).
-- Additive only: a new table, nothing existing is altered.

-- CreateTable
CREATE TABLE "AttendanceNote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceNote_organizationId_date_idx" ON "AttendanceNote"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceNote_employeeId_date_key" ON "AttendanceNote"("employeeId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceNote" ADD CONSTRAINT "AttendanceNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceNote" ADD CONSTRAINT "AttendanceNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
