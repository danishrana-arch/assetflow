CREATE TABLE "WorkCategory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project" ADD COLUMN "workCategoryId" TEXT;

CREATE UNIQUE INDEX "WorkCategory_organizationId_name_key"
  ON "WorkCategory"("organizationId","name");

CREATE INDEX "WorkCategory_organizationId_isActive_idx"
  ON "WorkCategory"("organizationId","isActive");

ALTER TABLE "WorkCategory"
  ADD CONSTRAINT "WorkCategory_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_workCategoryId_fkey"
  FOREIGN KEY ("workCategoryId")
  REFERENCES "WorkCategory"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;