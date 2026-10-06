-- Pro-rata leave policy: a separate ANNUAL leave type and the yearly
-- paid-leave pool (sick + casual + annual) per organization.
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'ANNUAL';

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "annualLeaveEntitlement" INTEGER NOT NULL DEFAULT 30;
