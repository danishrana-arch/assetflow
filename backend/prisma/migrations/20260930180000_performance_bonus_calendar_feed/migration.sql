-- Performance-review bonus, paid through payroll
ALTER TABLE "PerformanceReview" ADD COLUMN IF NOT EXISTS "bonusAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PerformanceReview" ADD COLUMN IF NOT EXISTS "bonusPayrollMonth" INTEGER;
ALTER TABLE "PerformanceReview" ADD COLUMN IF NOT EXISTS "bonusPayrollYear" INTEGER;
ALTER TABLE "PayrollRecord" ADD COLUMN IF NOT EXISTS "performanceBonus" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Personal calendar feed token (Google Calendar / Outlook subscription)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "calendarFeedToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_calendarFeedToken_key" ON "User"("calendarFeedToken");
