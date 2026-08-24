CREATE TYPE "AttendanceSource" AS ENUM ('MANUAL', 'BIOMETRIC');
CREATE TYPE "BiometricVendor" AS ENUM ('ZKTECO', 'HIKVISION', 'SUPREMA', 'ANVIZ', 'ESSL', 'HTTP', 'CUSTOM');
CREATE TYPE "BiometricConnectionMode" AS ENUM ('PULL', 'PUSH', 'HTTP');

ALTER TABLE "AttendanceRecord" ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'MANUAL', ADD COLUMN "biometricDeviceId" TEXT, ADD COLUMN "checkInAt" TIMESTAMP(3), ADD COLUMN "checkOutAt" TIMESTAMP(3), ADD COLUMN "workingMinutes" INTEGER;
CREATE INDEX "AttendanceRecord_organizationId_date_idx" ON "AttendanceRecord"("organizationId", "date");
CREATE INDEX "AttendanceRecord_biometricDeviceId_idx" ON "AttendanceRecord"("biometricDeviceId");

CREATE TABLE "BiometricDevice" (
 "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "name" TEXT NOT NULL, "vendor" "BiometricVendor" NOT NULL, "model" TEXT, "serialNumber" TEXT, "ipAddress" TEXT, "port" INTEGER, "connectionMode" "BiometricConnectionMode" NOT NULL DEFAULT 'PULL', "enabled" BOOLEAN NOT NULL DEFAULT true, "doorEnabled" BOOLEAN NOT NULL DEFAULT false, "unlockSeconds" INTEGER NOT NULL DEFAULT 5, "relayUrl" TEXT, "relaySecret" TEXT, "communicationKey" TEXT, "connectorTokenHash" TEXT, "connectorTokenCreatedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3), "lastSyncAt" TIMESTAMP(3), "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BiometricDevice_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BiometricDevice_organizationId_serialNumber_key" ON "BiometricDevice"("organizationId", "serialNumber");
CREATE INDEX "BiometricDevice_organizationId_idx" ON "BiometricDevice"("organizationId");

CREATE TABLE "BiometricDeviceEmployee" ("id" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "externalUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BiometricDeviceEmployee_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BiometricDeviceEmployee_deviceId_externalUserId_key" ON "BiometricDeviceEmployee"("deviceId", "externalUserId");
CREATE UNIQUE INDEX "BiometricDeviceEmployee_deviceId_employeeId_key" ON "BiometricDeviceEmployee"("deviceId", "employeeId");
CREATE INDEX "BiometricDeviceEmployee_employeeId_idx" ON "BiometricDeviceEmployee"("employeeId");

CREATE TABLE "BiometricPunch" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "deviceId" TEXT NOT NULL, "employeeId" TEXT, "externalUserId" TEXT NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL, "verification" TEXT, "externalId" TEXT, "rawPayload" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "BiometricPunch_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "BiometricPunch_deviceId_externalId_key" ON "BiometricPunch"("deviceId", "externalId");
CREATE INDEX "BiometricPunch_organizationId_occurredAt_idx" ON "BiometricPunch"("organizationId", "occurredAt");
CREATE INDEX "BiometricPunch_deviceId_occurredAt_idx" ON "BiometricPunch"("deviceId", "occurredAt");

ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_biometricDeviceId_fkey" FOREIGN KEY ("biometricDeviceId") REFERENCES "BiometricDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BiometricDevice" ADD CONSTRAINT "BiometricDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricDeviceEmployee" ADD CONSTRAINT "BiometricDeviceEmployee_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricDeviceEmployee" ADD CONSTRAINT "BiometricDeviceEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricPunch" ADD CONSTRAINT "BiometricPunch_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "BiometricDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BiometricPunch" ADD CONSTRAINT "BiometricPunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
