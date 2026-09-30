-- Payslip breakdown (tax / absent / late / other deductions, expense
-- reimbursement, termination) and employee office-expense claims.
ALTER TABLE "PayrollRecord"
  ADD COLUMN "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "absentDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "lateDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "otherDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "expenseReimbursement" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "terminationDate" TIMESTAMP(3),
  ADD COLUMN "terminationSettlement" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "terminationDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "terminationNote" TEXT;

-- Backfill the breakdown for existing payslips, whose `deductions` was a
-- single lump sum (late + unpaid leave, possibly hand-edited). Late is
-- re-derived from lateDays x the org's late rate (capped at the total);
-- the rest is attributed to absence when the record had unpaid days,
-- otherwise to "other". The total itself is unchanged.
UPDATE "PayrollRecord" p
SET "lateDeduction" = LEAST(p."deductions", p."lateDays" * COALESCE(NULLIF(o."lateDeductionAmount", 0), 500))
FROM "Organization" o
WHERE o."id" = p."organizationId";

UPDATE "PayrollRecord"
SET "absentDeduction" = CASE WHEN "unpaidLeaveDays" > 0 OR "halfDayLeaveDays" > 0 THEN "deductions" - "lateDeduction" ELSE 0 END;

UPDATE "PayrollRecord"
SET "otherDeduction" = "deductions" - "lateDeduction" - "absentDeduction";

CREATE TYPE "ExpenseClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ExpenseClaim" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL,
  "status" "ExpenseClaimStatus" NOT NULL DEFAULT 'PENDING',
  "payrollMonth" INTEGER,
  "payrollYear" INTEGER,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpenseClaim_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpenseClaim_organizationId_status_idx" ON "ExpenseClaim"("organizationId", "status");
CREATE INDEX "ExpenseClaim_employeeId_payrollYear_payrollMonth_idx" ON "ExpenseClaim"("employeeId", "payrollYear", "payrollMonth");

ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExpenseClaim" ADD CONSTRAINT "ExpenseClaim_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
