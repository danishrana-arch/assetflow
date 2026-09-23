-- Removes the SALES_HEAD role entirely. Postgres can't drop a single enum
-- value directly, so this rebuilds the UserRole enum without it and
-- repoints every column that uses it.
--
-- Pre-check done before writing this migration: 0 User rows and 7 stale
-- AttendancePermission rows (a role that was never configurable through
-- the Settings matrix, leftover from before SALES_HEAD was dropped from
-- CONFIGURABLE_ATTENDANCE_ROLES) referenced 'SALES_HEAD'. The DELETE below
-- clears those so the enum swap's USING cast doesn't fail on a value that
-- no longer exists in the new type.

DELETE FROM "AttendancePermission" WHERE "role" = 'SALES_HEAD';

BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'MANAGER', 'EMPLOYEE', 'CEO', 'HR', 'MANAGEMENT', 'DEPARTMENT_HEAD', 'IT_MANAGER');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "AttendancePermission" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';
COMMIT;
