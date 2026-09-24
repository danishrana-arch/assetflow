-- Removes the MANAGER ("Finance Manager") role entirely. Postgres can't
-- drop a single enum value directly, so this rebuilds the UserRole enum
-- without it and repoints every column that uses it.
--
-- Pre-check done before writing this migration: 0 User rows and 0
-- AttendancePermission rows referenced 'MANAGER' on the live DB, so no
-- reassignment was needed (unlike the SALES_HEAD removal, which had one
-- live user and 7 stale AttendancePermission rows). The DELETE below is
-- kept anyway as a defensive no-op, so the enum swap's USING cast can't
-- fail if that's changed by the time this actually runs.

DELETE FROM "AttendancePermission" WHERE "role" = 'MANAGER';

BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'EMPLOYEE', 'CEO', 'HR', 'MANAGEMENT', 'DEPARTMENT_HEAD', 'IT_MANAGER');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TABLE "AttendancePermission" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';
COMMIT;
