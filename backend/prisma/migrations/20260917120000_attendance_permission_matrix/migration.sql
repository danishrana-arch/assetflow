-- Per-role Attendance CRUD permission matrix, editable by ADMIN/CEO/MANAGER
-- from Settings. ADMIN/CEO/MANAGER themselves never get a row here — they're
-- always full-access in application code and can't be downgraded through
-- this table (see backend/src/utils/permissions.js). Roles with no row fall
-- back to a hardcoded default there too.

CREATE TABLE IF NOT EXISTS "AttendancePermission" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "canCreate" BOOLEAN NOT NULL DEFAULT FALSE,
  "canRead" BOOLEAN NOT NULL DEFAULT FALSE,
  "canUpdate" BOOLEAN NOT NULL DEFAULT FALSE,
  "canDelete" BOOLEAN NOT NULL DEFAULT FALSE,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendancePermission_organizationId_fkey') THEN
    ALTER TABLE "AttendancePermission" ADD CONSTRAINT "AttendancePermission_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AttendancePermission_organizationId_role_key" ON "AttendancePermission"("organizationId", "role");
