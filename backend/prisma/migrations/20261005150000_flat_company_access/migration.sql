-- Flat company access: no Grand Parent / Parent / Child, no "all call
-- centers" flag. Access is the CEO plus explicit OrganizationAccessGrant rows
-- (backend/src/utils/organization.js).
--
-- Keep what the old flag gave: every ADMIN with "callCenterAccess" gets a
-- grant for each active call center of their company group (other than
-- their own company), then the flag is cleared. Columns are not dropped.

INSERT INTO "OrganizationAccessGrant" ("id", "userId", "organizationId", "grantedById", "createdAt")
SELECT 'grant_' || md5(u."id" || ':' || o."id"), u."id", o."id", NULL, CURRENT_TIMESTAMP
  FROM "User" u
  JOIN "Organization" home ON home."id" = u."organizationId"
  JOIN "Organization" o
    ON COALESCE(o."companyId", o."id") = COALESCE(home."companyId", home."id")
 WHERE u."callCenterAccess" = true
   AND u."role" = 'ADMIN'
   AND o."officeType" = 'CALL_CENTER'
   AND o."archivedAt" IS NULL
   AND o."id" <> u."organizationId"
ON CONFLICT ("userId", "organizationId") DO NOTHING;

UPDATE "User" SET "callCenterAccess" = false WHERE "callCenterAccess" = true;
