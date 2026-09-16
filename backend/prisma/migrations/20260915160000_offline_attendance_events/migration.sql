-- Durable idempotency/event journal for offline attendance synchronization.
-- Keeps CHECK_IN and CHECK_OUT event IDs independently so one cannot overwrite the other.

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
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceSyncEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "AttendanceSyncEvent_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AttendanceSyncEvent_employeeId_status_idx"
  ON "AttendanceSyncEvent"("employeeId", "status");

CREATE INDEX IF NOT EXISTS "AttendanceSyncEvent_organizationId_createdAt_idx"
  ON "AttendanceSyncEvent"("organizationId", "createdAt");
