-- Office types (IT office / call center) and per-admin call-center access.
-- Additive: every existing organization is an IT office and no admin has
-- call-center access, so nobody's access changes until a CEO sets them.

CREATE TYPE "OrganizationOfficeType" AS ENUM ('IT_OFFICE', 'CALL_CENTER');

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "officeType" "OrganizationOfficeType" NOT NULL DEFAULT 'IT_OFFICE';

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "callCenterAccess" BOOLEAN NOT NULL DEFAULT false;
