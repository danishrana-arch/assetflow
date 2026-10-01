-- Flat per-day absent fine, set from the Attendance page (null = salary band).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "absentFineAmount" DECIMAL(10,2);
