ALTER TABLE "Project"
  ADD COLUMN "technologies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deadlineReminderSentAt" TIMESTAMP(3),
  ADD COLUMN "deadlineOverdueNotifiedAt" TIMESTAMP(3);
