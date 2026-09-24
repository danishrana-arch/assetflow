-- EmployeeFormSubmission still carried three required columns from the old,
-- never-actually-used invitation-based form flow (invitationId -> the dead
-- EmployeeFormInvitation model, data Json, updatedAt with no default). The
-- current public-token submit flow (submitPublicEmployeeForm) never sets
-- any of the three, so every submission insert failed with a Prisma
-- required-field validation error, surfaced to the employee as a generic
-- "Internal server error".
ALTER TABLE "EmployeeFormSubmission" ALTER COLUMN "invitationId" DROP NOT NULL;
ALTER TABLE "EmployeeFormSubmission" ALTER COLUMN "data" DROP NOT NULL;
