-- Final approver decides whether an approved leave is paid or unpaid.
ALTER TABLE "LeaveApplication" ADD COLUMN "payAs" TEXT;

-- Existing approved leave: unpaid type = UNPAID, everything else PAID.
UPDATE "LeaveApplication" SET "payAs" = CASE WHEN "type" = 'UNPAID' THEN 'UNPAID' ELSE 'PAID' END WHERE "status" = 'APPROVED';
