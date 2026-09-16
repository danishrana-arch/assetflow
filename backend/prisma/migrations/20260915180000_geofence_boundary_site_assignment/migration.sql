-- Robust geofence/site migration. Safe when earlier attendance migrations were already applied.

CREATE TABLE IF NOT EXISTS "AttendanceSite" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "latitude" DECIMAL(10,7) NOT NULL,
  "longitude" DECIMAL(10,7) NOT NULL,
  "radiusMeters" INTEGER NOT NULL DEFAULT 250,
  "timezone" TEXT,
  "managerId" TEXT,
  "geofenceMode" TEXT NOT NULL DEFAULT 'WARNING',
  "qrCode" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" TEXT,
  "outsideGraceMinutes" INTEGER NOT NULL DEFAULT 60,
  "autoFinalize" BOOLEAN NOT NULL DEFAULT TRUE,
  "geofenceType" TEXT NOT NULL DEFAULT 'RADIUS',
  "boundary" JSONB,
  "areaSqMeters" DOUBLE PRECISION,
  "perimeterMeters" DOUBLE PRECISION
);

ALTER TABLE "AttendanceSite"
  ADD COLUMN IF NOT EXISTS "projectId" TEXT,
  ADD COLUMN IF NOT EXISTS "outsideGraceMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "autoFinalize" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "geofenceType" TEXT NOT NULL DEFAULT 'RADIUS',
  ADD COLUMN IF NOT EXISTS "boundary" JSONB,
  ADD COLUMN IF NOT EXISTS "areaSqMeters" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "perimeterMeters" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "AttendanceSiteEmployee" (
  "siteId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("siteId","employeeId")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendanceSite_organizationId_fkey') THEN
    ALTER TABLE "AttendanceSite" ADD CONSTRAINT "AttendanceSite_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendanceSite_managerId_fkey') THEN
    ALTER TABLE "AttendanceSite" ADD CONSTRAINT "AttendanceSite_managerId_fkey"
      FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendanceSite_projectId_fkey') THEN
    ALTER TABLE "AttendanceSite" ADD CONSTRAINT "AttendanceSite_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendanceSiteEmployee_siteId_fkey') THEN
    ALTER TABLE "AttendanceSiteEmployee" ADD CONSTRAINT "AttendanceSiteEmployee_siteId_fkey"
      FOREIGN KEY ("siteId") REFERENCES "AttendanceSite"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendanceSiteEmployee_employeeId_fkey') THEN
    ALTER TABLE "AttendanceSiteEmployee" ADD CONSTRAINT "AttendanceSiteEmployee_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AttendanceSite_projectId_idx" ON "AttendanceSite"("projectId");
CREATE INDEX IF NOT EXISTS "AttendanceSite_organizationId_active_idx" ON "AttendanceSite"("organizationId","active");
CREATE INDEX IF NOT EXISTS "AttendanceSiteEmployee_employeeId_idx" ON "AttendanceSiteEmployee"("employeeId");

CREATE TABLE IF NOT EXISTS "AttendancePresenceEvent" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "attendanceId" TEXT,
  "siteId" TEXT,
  "eventType" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "gpsAccuracy" DOUBLE PRECISION,
  "distanceMeters" DOUBLE PRECISION,
  "inside" BOOLEAN,
  "clientEventId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendancePresenceEvent_organizationId_fkey') THEN
    ALTER TABLE "AttendancePresenceEvent" ADD CONSTRAINT "AttendancePresenceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendancePresenceEvent_employeeId_fkey') THEN
    ALTER TABLE "AttendancePresenceEvent" ADD CONSTRAINT "AttendancePresenceEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendancePresenceEvent_attendanceId_fkey') THEN
    ALTER TABLE "AttendancePresenceEvent" ADD CONSTRAINT "AttendancePresenceEvent_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='AttendancePresenceEvent_siteId_fkey') THEN
    ALTER TABLE "AttendancePresenceEvent" ADD CONSTRAINT "AttendancePresenceEvent_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AttendanceSite"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AttendancePresenceEvent_clientEventId_key" ON "AttendancePresenceEvent"("clientEventId") WHERE "clientEventId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "AttendancePresenceEvent_employee_recorded_idx" ON "AttendancePresenceEvent"("employeeId","recordedAt");
CREATE INDEX IF NOT EXISTS "AttendancePresenceEvent_attendance_recorded_idx" ON "AttendancePresenceEvent"("attendanceId","recordedAt");

CREATE TABLE IF NOT EXISTS "AttendanceSyncEvent" (
  "id" TEXT PRIMARY KEY,
  "clientEventId" TEXT NOT NULL UNIQUE,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "localDate" DATE NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AttendanceSyncEvent_employeeId_status_idx" ON "AttendanceSyncEvent"("employeeId","status");
CREATE INDEX IF NOT EXISTS "AttendanceSyncEvent_organizationId_createdAt_idx" ON "AttendanceSyncEvent"("organizationId","createdAt");
