-- Company late-arrival rules + where payroll records their effect.
CREATE TABLE "LatePolicyRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lateCount" INTEGER NOT NULL,
    "result" TEXT NOT NULL DEFAULT 'HALF_DAY',
    "deductFrom" TEXT NOT NULL DEFAULT 'LEAVE',
    "replaceLateFine" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LatePolicyRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LatePolicyRule_organizationId_idx" ON "LatePolicyRule"("organizationId");

ALTER TABLE "LatePolicyRule" ADD CONSTRAINT "LatePolicyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollRecord" ADD COLUMN "latePenaltyDays" DECIMAL(6,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollRecord" ADD COLUMN "latePenaltyDeduction" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollRecord" ADD COLUMN "latePenaltyLeaveDays" DECIMAL(6,2) NOT NULL DEFAULT 0;

-- Default rule for every existing company: 3 late arrivals = half day,
-- taken from the leave balance (salary when no leave is left).
INSERT INTO "LatePolicyRule" ("id", "organizationId", "name", "lateCount", "result", "deductFrom", "replaceLateFine", "updatedAt")
SELECT 'lpr' || substr(md5(random()::text || o."id"), 1, 22), o."id", '3 late arrivals = half day', 3, 'HALF_DAY', 'LEAVE', true, CURRENT_TIMESTAMP
FROM "Organization" o;
