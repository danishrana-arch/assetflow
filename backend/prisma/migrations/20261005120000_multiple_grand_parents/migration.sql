-- Multiple Grand Parent companies per company group, as a real tree:
-- "parentOrganizationId" = the company directly above (null for a Grand
-- Parent). See backend/src/utils/organization.js.

-- A group may now hold any number of Grand Parents and Parents.
DROP INDEX IF EXISTS "Organization_one_grand_parent_per_company";
DROP INDEX IF EXISTS "Organization_one_parent_per_company";

-- Backfill the tree so every role keeps exactly the access it had under the
-- old flat rule (Grand Parent → Parent + all Children; Parent → all Children):

-- Grand Parents are tree roots.
UPDATE "Organization"
   SET "parentOrganizationId" = NULL
 WHERE "hierarchyRole" = 'GRAND_PARENT';

-- The Parent belongs to its group's Grand Parent.
UPDATE "Organization" o
   SET "parentOrganizationId" = gp."id"
  FROM "Organization" gp
 WHERE o."hierarchyRole" = 'PARENT'
   AND gp."hierarchyRole" = 'GRAND_PARENT'
   AND COALESCE(gp."companyId", gp."id") = COALESCE(o."companyId", o."id");

-- Children go under the group's Parent when there is one (it could already
-- reach every Child), otherwise directly under the Grand Parent.
UPDATE "Organization" o
   SET "parentOrganizationId" = COALESCE(
         (SELECT p."id" FROM "Organization" p
           WHERE p."hierarchyRole" = 'PARENT'
             AND COALESCE(p."companyId", p."id") = COALESCE(o."companyId", o."id")
           LIMIT 1),
         (SELECT gp."id" FROM "Organization" gp
           WHERE gp."hierarchyRole" = 'GRAND_PARENT'
             AND COALESCE(gp."companyId", gp."id") = COALESCE(o."companyId", o."id")
           LIMIT 1),
         o."parentOrganizationId")
 WHERE o."hierarchyRole" = 'CHILD';
