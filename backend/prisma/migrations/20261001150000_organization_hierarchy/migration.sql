-- Company hierarchy: GRAND_PARENT → PARENT → CHILD per company group
-- (organizations sharing "companyId"). Additive: no column or row is dropped.

CREATE TYPE "OrganizationHierarchyRole" AS ENUM ('GRAND_PARENT', 'PARENT', 'CHILD');

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "hierarchyRole" "OrganizationHierarchyRole" NOT NULL DEFAULT 'CHILD';

-- Backfill so current access is preserved:
--  * each group's root (the old "main company") becomes the Grand Parent;
--  * the old "second main company" (isCoMain) becomes the Parent.
UPDATE "Organization"
   SET "hierarchyRole" = 'GRAND_PARENT'
 WHERE "parentOrganizationId" IS NULL
   AND ("companyId" IS NULL OR "companyId" = "id");

UPDATE "Organization"
   SET "hierarchyRole" = 'PARENT'
 WHERE "isCoMain" = true
   AND "hierarchyRole" = 'CHILD';

-- At most one Grand Parent and one Parent per company group, enforced by the
-- database (Prisma can't express partial indexes, so it lives here only).
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_one_grand_parent_per_company"
  ON "Organization" (COALESCE("companyId", "id"))
  WHERE "hierarchyRole" = 'GRAND_PARENT';

CREATE UNIQUE INDEX IF NOT EXISTS "Organization_one_parent_per_company"
  ON "Organization" (COALESCE("companyId", "id"))
  WHERE "hierarchyRole" = 'PARENT';
