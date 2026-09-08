CREATE TABLE IF NOT EXISTS "CompanyEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT,
  "title" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'ANNUAL_EVENT',
  "isAnnual" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CompanyEvent_organizationId_date_idx" ON "CompanyEvent"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "CompanyEvent_organizationId_type_idx" ON "CompanyEvent"("organizationId", "type");

DO $$ BEGIN
  ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CompanyEvent" ADD CONSTRAINT "CompanyEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
