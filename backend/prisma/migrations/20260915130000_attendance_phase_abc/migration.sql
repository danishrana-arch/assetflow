-- AssetFlow Attendance Phase A+B+C
-- Offline-first attendance, sites/geofences, corrections and anomaly evidence.
-- Safe for existing databases: all additions are IF NOT EXISTS.

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "remoteOfflineGraceMinutes" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "AttendanceRecord"
  ADD COLUMN IF NOT EXISTS "siteId" TEXT,
  ADD COLUMN IF NOT EXISTS "offlineRecorded" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "localRecordedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "syncedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clientEventId" TEXT,
  ADD COLUMN IF NOT EXISTS "gpsAccuracy" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "networkType" TEXT,
  ADD COLUMN IF NOT EXISTS "attendanceDeviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "verificationHash" TEXT;

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
  CONSTRAINT "AttendanceSite_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceSite_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "AttendanceSiteEmployee" (
  "siteId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("siteId","employeeId"),
  CONSTRAINT "AttendanceSiteEmployee_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "AttendanceSite"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceSiteEmployee_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AttendanceCorrection" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "attendanceId" TEXT,
  "requestedCheckInAt" TIMESTAMP(3),
  "requestedCheckOutAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceCorrection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceCorrection_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceCorrection_attendanceId_fkey"
    FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL,
  CONSTRAINT "AttendanceCorrection_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "AttendanceAnomaly" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT,
  "attendanceId" TEXT,
  "siteId" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "message" TEXT NOT NULL,
  "metadata" JSONB,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceAnomaly_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceAnomaly_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "AttendanceAnomaly_attendanceId_fkey"
    FOREIGN KEY ("attendanceId") REFERENCES "AttendanceRecord"("id") ON DELETE SET NULL,
  CONSTRAINT "AttendanceAnomaly_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "AttendanceSite"("id") ON DELETE SET NULL,
  CONSTRAINT "AttendanceAnomaly_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_clientEventId_key"
  ON "AttendanceRecord"("clientEventId")
  WHERE "clientEventId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "AttendanceRecord_siteId_date_idx"
  ON "AttendanceRecord"("siteId","date");

CREATE INDEX IF NOT EXISTS "AttendanceRecord_offlineRecorded_idx"
  ON "AttendanceRecord"("offlineRecorded");

CREATE INDEX IF NOT EXISTS "AttendanceSite_organizationId_active_idx"
  ON "AttendanceSite"("organizationId","active");

CREATE INDEX IF NOT EXISTS "AttendanceSiteEmployee_employeeId_idx"
  ON "AttendanceSiteEmployee"("employeeId");

CREATE INDEX IF NOT EXISTS "AttendanceCorrection_organizationId_status_idx"
  ON "AttendanceCorrection"("organizationId","status");

CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_organizationId_createdAt_idx"
  ON "AttendanceAnomaly"("organizationId","createdAt");

CREATE INDEX IF NOT EXISTS "AttendanceAnomaly_employeeId_resolvedAt_idx"
  ON "AttendanceAnomaly"("employeeId","resolvedAt");
