-- Tasks no longer require a project — a task can be assigned directly to
-- an employee with no parent project. The FK's ON DELETE CASCADE is
-- unaffected by nullability: it only fires when projectId is non-null and
-- that project row is deleted.
ALTER TABLE "Task" ALTER COLUMN "projectId" DROP NOT NULL;
