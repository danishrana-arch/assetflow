CREATE TABLE "Announcement" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"createdById" TEXT NOT NULL,"title" TEXT NOT NULL,"body" TEXT NOT NULL,"audienceType" TEXT NOT NULL DEFAULT 'ALL',"audienceId" TEXT,"publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Announcement_organizationId_publishedAt_idx" ON "Announcement"("organizationId","publishedAt");
CREATE INDEX "Announcement_audienceType_audienceId_idx" ON "Announcement"("audienceType","audienceId");
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON UPDATE CASCADE;
