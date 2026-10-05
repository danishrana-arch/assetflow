-- CEO-granted company access for specific ADMIN / IT_MANAGER users.
-- Additive (new table only).

CREATE TABLE IF NOT EXISTS "OrganizationAccessGrant" (
  "id"             TEXT         NOT NULL,
  "userId"         TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "grantedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationAccessGrant_userId_organizationId_key"
  ON "OrganizationAccessGrant" ("userId", "organizationId");
CREATE INDEX IF NOT EXISTS "OrganizationAccessGrant_organizationId_idx"
  ON "OrganizationAccessGrant" ("organizationId");

ALTER TABLE "OrganizationAccessGrant"
  ADD CONSTRAINT "OrganizationAccessGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationAccessGrant"
  ADD CONSTRAINT "OrganizationAccessGrant_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationAccessGrant"
  ADD CONSTRAINT "OrganizationAccessGrant_grantedById_fkey"
  FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
