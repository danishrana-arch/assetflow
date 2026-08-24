-- Organization work schedule for automatic attendance calculations.
ALTER TABLE "Organization"
  ADD COLUMN "workingHoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
  ADD COLUMN "workingDaysPerWeek" INTEGER NOT NULL DEFAULT 5;

-- The BiometricPunch -> Organization foreign key already exists
-- in an earlier migration, so it must NOT be recreated here.
CREATE INDEX "BiometricPunch_organizationId_idx"
  ON "BiometricPunch"("organizationId");