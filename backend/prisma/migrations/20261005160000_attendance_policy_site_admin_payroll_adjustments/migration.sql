-- Attendance policy (half day / early going), SITE_ADMIN role + site
-- assignments, attendance engine result columns, payroll adjustment audit.
-- Additive only: new columns have defaults or are nullable; no data changes.

-- CreateEnum
CREATE TYPE "AttendanceDayType" AS ENUM ('FULL_DAY', 'HALF_DAY', 'EARLY_GOING');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SITE_ADMIN';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "earlyGoingFineAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "earlyGoingThresholdHours" DECIMAL(4,2) NOT NULL DEFAULT 2,
ADD COLUMN     "halfDayDeductionPercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
ADD COLUMN     "halfDayMinimumHours" DECIMAL(4,2) NOT NULL DEFAULT 4.5,
ADD COLUMN     "lateHalfDayThresholdHours" DECIMAL(4,2) NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "checkOutSiteId" TEXT,
ADD COLUMN     "dayType" "AttendanceDayType",
ADD COLUMN     "dayTypeReason" TEXT,
ADD COLUMN     "deductionDays" DECIMAL(4,2),
ADD COLUMN     "earlyGoingFine" DECIMAL(10,2),
ADD COLUMN     "earlyGoingMinutes" INTEGER,
ADD COLUMN     "evaluatedAt" TIMESTAMP(3),
ADD COLUMN     "lateMinutes" INTEGER,
ADD COLUMN     "scheduledEndAt" TIMESTAMP(3),
ADD COLUMN     "scheduledStartAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "adjustmentTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "earlyGoingDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "earlyGoingFine" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "halfDayDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "halfDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "AttendanceCorrection" ADD COLUMN     "requestedById" TEXT;

-- AlterTable
ALTER TABLE "AttendancePresenceEvent" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- CreateTable
CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "payrollRecordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "line" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "originalValue" DECIMAL(12,2),
    "newValue" DECIMAL(12,2),
    "previousNetPay" DECIMAL(12,2) NOT NULL,
    "newNetPay" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "payslipStatus" "PayrollStatus" NOT NULL,
    "finalizedOverride" BOOLEAN NOT NULL DEFAULT false,
    "reversesId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSiteAdmin" (
    "siteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSiteAdmin_pkey" PRIMARY KEY ("siteId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollAdjustment_reversesId_key" ON "PayrollAdjustment"("reversesId");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_payrollRecordId_createdAt_idx" ON "PayrollAdjustment"("payrollRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "PayrollAdjustment_organizationId_createdAt_idx" ON "PayrollAdjustment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AttendanceSiteAdmin_userId_idx" ON "AttendanceSiteAdmin"("userId");

-- CreateIndex
CREATE INDEX "AttendanceSiteAdmin_organizationId_idx" ON "AttendanceSiteAdmin"("organizationId");

-- CreateIndex
CREATE INDEX "AttendancePresenceEvent_actorId_recordedAt_idx" ON "AttendancePresenceEvent"("actorId", "recordedAt");

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "PayrollRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "PayrollAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendancePresenceEvent" ADD CONSTRAINT "AttendancePresenceEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSiteAdmin" ADD CONSTRAINT "AttendanceSiteAdmin_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AttendanceSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSiteAdmin" ADD CONSTRAINT "AttendanceSiteAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSiteAdmin" ADD CONSTRAINT "AttendanceSiteAdmin_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

