-- Deleting an employee used to fail outright if they had ever posted an
-- announcement: Announcement.createdById was NOT NULL with ON DELETE
-- RESTRICT, so the User row (and their email) could never be removed.
-- Keep the announcement, just clear its author (the UI already falls back
-- to "Management" when createdBy is null).
ALTER TABLE "Announcement" ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_createdById_fkey";
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
