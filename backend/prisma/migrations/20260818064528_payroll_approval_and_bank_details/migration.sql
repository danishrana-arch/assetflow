-- AlterEnum
ALTER TYPE "AttendanceStatus" ADD VALUE 'LATE';

-- AlterEnum
ALTER TYPE "PayrollStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "lateDeductionAmount" DECIMAL(10,2) NOT NULL DEFAULT 500,
ADD COLUMN     "payrollAccountNumber" TEXT,
ADD COLUMN     "payrollBankName" TEXT;

-- AlterTable
ALTER TABLE "PayrollRecord" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "halfDayLeaveDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lateDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankName" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollRecord" ADD CONSTRAINT "PayrollRecord_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
