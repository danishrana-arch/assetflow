-- Add company hierarchy support without changing existing organizations.
ALTER TABLE "Organization"
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "parentOrganizationId" TEXT;

-- Existing organizations are standalone companies, so each becomes its own root.
UPDATE "Organization"
SET "companyId" = "id"
WHERE "companyId" IS NULL;

ALTER TABLE "Organization"
  ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX "Organization_companyId_idx"
  ON "Organization"("companyId");

CREATE INDEX "Organization_parentOrganizationId_idx"
  ON "Organization"("parentOrganizationId");

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_parentOrganizationId_fkey"
  FOREIGN KEY ("parentOrganizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
