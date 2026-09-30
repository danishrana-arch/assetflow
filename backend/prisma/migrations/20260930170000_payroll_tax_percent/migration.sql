-- Tax entered as a percentage of basic pay (PayrollRecord.tax is derived
-- from it). Was added to 20260930140000_payslip_breakdown_expense_claims
-- after that migration had already been applied, so it never reached the
-- database — added here instead. IF NOT EXISTS keeps it safe on a database
-- that did get the column from the edited file.
ALTER TABLE "PayrollRecord" ADD COLUMN IF NOT EXISTS "taxPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
