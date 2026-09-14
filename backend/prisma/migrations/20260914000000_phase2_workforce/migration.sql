ALTER TABLE "Department" ADD COLUMN "managerId" TEXT;
CREATE INDEX "Department_organizationId_idx" ON "Department"("organizationId");
CREATE INDEX "Department_managerId_idx" ON "Department"("managerId");
ALTER TABLE "Department" ADD CONSTRAINT "Department_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'TODO',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "assignedToId" TEXT,
  "createdById" TEXT,
  "dueDate" DATE,
  "estimatedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "actualHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Task_organizationId_status_idx" ON "Task"("organizationId", "status");
CREATE INDEX "Task_organizationId_projectId_idx" ON "Task"("organizationId", "projectId");
CREATE INDEX "Task_assignedToId_status_idx" ON "Task"("assignedToId", "status");
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "projectId" TEXT,
  "taskId" TEXT,
  "date" DATE NOT NULL,
  "hours" DECIMAL(6,2) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TimeEntry_organizationId_date_idx" ON "TimeEntry"("organizationId", "date");
CREATE INDEX "TimeEntry_employeeId_date_idx" ON "TimeEntry"("employeeId", "date");
CREATE INDEX "TimeEntry_projectId_date_idx" ON "TimeEntry"("projectId", "date");
CREATE INDEX "TimeEntry_taskId_date_idx" ON "TimeEntry"("taskId", "date");
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PerformanceReview" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "reviewerId" TEXT,
  "periodStart" DATE NOT NULL,
  "periodEnd" DATE NOT NULL,
  "rating" INTEGER NOT NULL,
  "goals" TEXT,
  "achievements" TEXT,
  "feedback" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PerformanceReview_organizationId_employeeId_periodEnd_idx" ON "PerformanceReview"("organizationId", "employeeId", "periodEnd");
CREATE INDEX "PerformanceReview_reviewerId_createdAt_idx" ON "PerformanceReview"("reviewerId", "createdAt");
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
