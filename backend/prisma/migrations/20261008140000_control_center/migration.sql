-- Control Center: platform admin role, structured audit details, plan
-- entitlements/limits, platform feature switches and per-organization
-- feature overrides. Every existing plan keeps ALL features so nothing is
-- locked out by this migration; the platform admin narrows plans afterwards.

ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PLATFORM_ADMIN';

ALTER TABLE "AuditLog" ADD COLUMN "details" JSONB;

ALTER TABLE "BillingPlan"
  ADD COLUMN "featureKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "siteLimit" INTEGER,
  ADD COLUMN "projectLimit" INTEGER,
  ADD COLUMN "organizationLimit" INTEGER,
  ADD COLUMN "storageLimitMb" INTEGER,
  ADD COLUMN "billingInterval" TEXT NOT NULL DEFAULT 'MONTH',
  ADD COLUMN "stripePriceId" TEXT;

-- Keep this list equal to FEATURES in backend/src/utils/features.js.
UPDATE "BillingPlan" SET "featureKeys" = ARRAY[
  'employees','attendance','leave','payroll','projects','performance',
  'assets','reports','biometric','orgComparison'
]::TEXT[];

CREATE TABLE "PlatformFeature" (
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformFeature_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OrganizationFeatureOverride" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "note" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationFeatureOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationFeatureOverride_organizationId_featureKey_key"
  ON "OrganizationFeatureOverride"("organizationId", "featureKey");

ALTER TABLE "OrganizationFeatureOverride"
  ADD CONSTRAINT "OrganizationFeatureOverride_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
