-- Per-day WFH mode on an attendance record (distinct from the employee's
-- fixed User.workLocationType classification). WFH check-ins skip the
-- geofence check entirely.
CREATE TYPE "AttendanceLocationMode" AS ENUM ('OFFICE', 'FIELD', 'WFH');

ALTER TABLE "AttendanceRecord" ADD COLUMN "locationMode" "AttendanceLocationMode" NOT NULL DEFAULT 'OFFICE';
