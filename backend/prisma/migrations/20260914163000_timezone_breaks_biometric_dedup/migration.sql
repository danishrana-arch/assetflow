-- Organization-local attendance settings.
ALTER TABLE "Organization" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE "Organization" ADD COLUMN "breakStart" TEXT;
ALTER TABLE "Organization" ADD COLUMN "breakEnd" TEXT;

-- A deterministic fingerprint makes biometric ingestion idempotent even when
-- the device/connector does not provide a stable external event ID.
ALTER TABLE "BiometricPunch" ADD COLUMN "fingerprint" TEXT;

WITH ranked AS (
  SELECT
    "id",
    md5("deviceId" || '|' || "externalUserId" || '|' || floor(extract(epoch from "occurredAt") * 1000)::text) AS base_fingerprint,
    ROW_NUMBER() OVER (
      PARTITION BY "deviceId", "externalUserId", floor(extract(epoch from "occurredAt") * 1000)
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "BiometricPunch"
)
UPDATE "BiometricPunch" p
SET "fingerprint" = CASE
  WHEN ranked.rn = 1 THEN ranked.base_fingerprint
  ELSE ranked.base_fingerprint || ':' || p."id"
END
FROM ranked
WHERE p."id" = ranked."id";

ALTER TABLE "BiometricPunch" ALTER COLUMN "fingerprint" SET NOT NULL;
CREATE UNIQUE INDEX "BiometricPunch_fingerprint_key" ON "BiometricPunch"("fingerprint");
