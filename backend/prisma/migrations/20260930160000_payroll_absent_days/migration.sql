-- Count of attendance days marked ABSENT in the payroll month; deducted at
-- the unpaid-leave daily rate as part of "absentDeduction".
ALTER TABLE "PayrollRecord" ADD COLUMN "absentDays" INTEGER NOT NULL DEFAULT 0;
