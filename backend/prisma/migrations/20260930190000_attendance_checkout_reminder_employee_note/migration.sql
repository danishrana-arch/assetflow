-- Shift-end checkout reminder / automatic checkout, and the employee's own day note
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "checkoutReminderSentAt" TIMESTAMP(3);
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "autoCheckedOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "employeeNote" TEXT;
ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "extraMinutes" INTEGER;
