-- Attendance-page fines (waive the automatic late/absent fine, or add a
-- manual one) and HR "seen" marker on employee notes. Additive only.

CREATE TABLE IF NOT EXISTS "AttendanceFine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "waived" BOOLEAN NOT NULL DEFAULT false,
  "extraAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "reason" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceFine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceFine_employeeId_date_key" ON "AttendanceFine"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "AttendanceFine_organizationId_date_idx" ON "AttendanceFine"("organizationId", "date");

ALTER TABLE "AttendanceFine" ADD CONSTRAINT "AttendanceFine_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceFine" ADD CONSTRAINT "AttendanceFine_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollRecord" ADD COLUMN IF NOT EXISTS "fineDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "employeeNoteSeenAt" TIMESTAMP(3);
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "employeeNoteSeenById" TEXT;
