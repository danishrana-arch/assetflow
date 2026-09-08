DO $$ BEGIN
  CREATE TYPE "EmployeeFormSubmissionStatus" AS ENUM ('SUBMITTED', 'REVIEWED', 'CONVERTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "personalEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "fatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "education" TEXT,
  ADD COLUMN IF NOT EXISTS "currentUniversity" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftStart" TEXT,
  ADD COLUMN IF NOT EXISTS "shiftEnd" TEXT;

CREATE TABLE IF NOT EXISTS "Certification" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "institute" TEXT NOT NULL,
  "credentialId" TEXT,
  "credentialUrl" TEXT,
  "issuedDate" TIMESTAMP(3),
  "expiryDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Certification"
  ADD COLUMN IF NOT EXISTS "credentialId" TEXT,
  ADD COLUMN IF NOT EXISTS "credentialUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "issuedDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiryDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Certification_employeeId_idx" ON "Certification"("employeeId");

DO $$ BEGIN
  ALTER TABLE "Certification"
    ADD CONSTRAINT "Certification_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EmployeeForm" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdById" TEXT,
  "title" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenEncrypted" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeForm_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmployeeForm"
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdById" TEXT,
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenEncrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeForm_tokenHash_key" ON "EmployeeForm"("tokenHash");
CREATE INDEX IF NOT EXISTS "EmployeeForm_organizationId_active_idx" ON "EmployeeForm"("organizationId", "active");

DO $$ BEGIN
  ALTER TABLE "EmployeeForm"
    ADD CONSTRAINT "EmployeeForm_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeeForm"
    ADD CONSTRAINT "EmployeeForm_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EmployeeFormSubmission" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fatherName" TEXT,
  "personalEmail" TEXT,
  "phone" TEXT,
  "address" TEXT,
  "cnic" TEXT,
  "dob" TIMESTAMP(3),
  "education" TEXT,
  "currentUniversity" TEXT,
  "seniorityLevel" "SeniorityLevel",
  "companyEmail" TEXT,
  "linkedinUrl" TEXT,
  "notes" TEXT,
  "status" "EmployeeFormSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "convertedEmployeeId" TEXT,
  CONSTRAINT "EmployeeFormSubmission_pkey" PRIMARY KEY ("id")
);

-- The table may have been created by an earlier attempt without all columns.
-- Add every expected column before creating indexes/foreign keys.
ALTER TABLE "EmployeeFormSubmission"
  ADD COLUMN IF NOT EXISTS "formId" TEXT,
  ADD COLUMN IF NOT EXISTS "organizationId" TEXT,
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "fatherName" TEXT,
  ADD COLUMN IF NOT EXISTS "personalEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "phone" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "cnic" TEXT,
  ADD COLUMN IF NOT EXISTS "dob" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "education" TEXT,
  ADD COLUMN IF NOT EXISTS "currentUniversity" TEXT,
  ADD COLUMN IF NOT EXISTS "seniorityLevel" "SeniorityLevel",
  ADD COLUMN IF NOT EXISTS "companyEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "linkedinUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "notes" TEXT,
  ADD COLUMN IF NOT EXISTS "status" "EmployeeFormSubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "convertedEmployeeId" TEXT;

CREATE INDEX IF NOT EXISTS "EmployeeFormSubmission_formId_submittedAt_idx" ON "EmployeeFormSubmission"("formId", "submittedAt");
CREATE INDEX IF NOT EXISTS "EmployeeFormSubmission_organizationId_status_idx" ON "EmployeeFormSubmission"("organizationId", "status");

DO $$ BEGIN
  ALTER TABLE "EmployeeFormSubmission"
    ADD CONSTRAINT "EmployeeFormSubmission_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "EmployeeForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeeFormSubmission"
    ADD CONSTRAINT "EmployeeFormSubmission_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "EmployeeFormSubmission"
    ADD CONSTRAINT "EmployeeFormSubmission_convertedEmployeeId_fkey"
    FOREIGN KEY ("convertedEmployeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
