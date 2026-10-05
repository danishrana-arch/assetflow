-- Employee details (identification, emergency contact, start date,
-- employment status), employee documents, and the two-step leave workflow
-- (HR → Admin/CEO). Additive except the LeaveStatus rename below.

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('PROBATION', 'PERMANENT');
CREATE TYPE "EmployeeDocumentKind" AS ENUM ('PASSPORT', 'CIVIL_ID', 'OTHER');

-- Leave: existing PENDING requests become PENDING_HR (same meaning — waiting
-- for the first decision). RENAME VALUE keeps every stored row and the
-- column default pointing at it.
ALTER TYPE "LeaveStatus" RENAME VALUE 'PENDING' TO 'PENDING_HR';
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'PENDING_FINAL_APPROVAL' AFTER 'PENDING_HR';

-- AlterTable: User
ALTER TABLE "User"
  ADD COLUMN "startDate" TIMESTAMP(3),
  ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'PROBATION',
  ADD COLUMN "permanentDate" DATE,
  ADD COLUMN "passportNumber" TEXT,
  ADD COLUMN "civilNumber" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "agentName" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactRelationship" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "emergencyContactAltPhone" TEXT,
  ADD COLUMN "emergencyContactAddress" TEXT,
  ADD COLUMN "emergencyContactNotes" TEXT;

-- Everyone who exists today could already apply for leave, so they start as
-- PERMANENT (from their joining date, else account creation) — nobody loses
-- leave access by this migration. New employees default to PROBATION.
UPDATE "User"
SET "employmentStatus" = 'PERMANENT',
    "permanentDate" = COALESCE("joiningDate", "createdAt")::date;

-- AlterTable: LeaveApplication
ALTER TABLE "LeaveApplication"
  ADD COLUMN "hrReviewedById" TEXT,
  ADD COLUMN "hrReviewedAt" TIMESTAMP(3),
  ADD COLUMN "hrReviewNote" TEXT;
ALTER TABLE "LeaveApplication" ALTER COLUMN "status" SET DEFAULT 'PENDING_HR';
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_hrReviewedById_fkey"
  FOREIGN KEY ("hrReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "EmployeeDocumentKind" NOT NULL DEFAULT 'OTHER',
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmployeeDocument_employeeId_kind_idx" ON "EmployeeDocument"("employeeId", "kind");

ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
