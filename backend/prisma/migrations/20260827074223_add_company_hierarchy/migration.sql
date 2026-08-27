-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "parentOrganizationId" TEXT;

-- CreateIndex
CREATE INDEX "Organization_companyId_idx" ON "Organization"("companyId");

-- CreateIndex
CREATE INDEX "Organization_parentOrganizationId_idx" ON "Organization"("parentOrganizationId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_parentOrganizationId_fkey" FOREIGN KEY ("parentOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
