-- CreateEnum
CREATE TYPE "WorkLocationType" AS ENUM ('OFFICE', 'FIELD');

-- AlterTable: Organization — attendance geofence config
ALTER TABLE "Organization" ADD COLUMN     "geofenceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "officeLatitude" DECIMAL(10,7),
ADD COLUMN     "officeLongitude" DECIMAL(10,7),
ADD COLUMN     "geofenceRadiusMeters" INTEGER NOT NULL DEFAULT 200;

-- AlterTable: User — designation / joining date / work location type
ALTER TABLE "User" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "joiningDate" TIMESTAMP(3),
ADD COLUMN     "workLocationType" "WorkLocationType" NOT NULL DEFAULT 'OFFICE';

-- AlterTable: AttendanceRecord — captured location + auto-flag
ALTER TABLE "AttendanceRecord" ADD COLUMN     "latitude" DECIMAL(10,7),
ADD COLUMN     "longitude" DECIMAL(10,7),
ADD COLUMN     "distanceMeters" INTEGER,
ADD COLUMN     "autoFlagged" BOOLEAN NOT NULL DEFAULT false;
