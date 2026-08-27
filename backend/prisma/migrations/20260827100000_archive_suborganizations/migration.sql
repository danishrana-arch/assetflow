ALTER TABLE "Organization" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Organization_archivedAt_idx" ON "Organization"("archivedAt");
