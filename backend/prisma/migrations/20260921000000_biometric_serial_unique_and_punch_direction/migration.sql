-- A device's serial number must be unique across the whole deployment, not
-- just within one organization: ADMS identifies a device solely by serial
-- number (no org id in that protocol), so two orgs registering the same
-- serial number would make that lookup ambiguous between them.
DROP INDEX IF EXISTS "BiometricDevice_organizationId_serialNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "BiometricDevice_serialNumber_key" ON "BiometricDevice"("serialNumber");

-- Explicit IN/OUT button-press direction, when the protocol reports it.
ALTER TABLE "BiometricPunch" ADD COLUMN IF NOT EXISTS "direction" TEXT;
