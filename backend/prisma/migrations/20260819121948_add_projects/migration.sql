-- DropForeignKey
ALTER TABLE "AttendanceRecord" DROP CONSTRAINT "AttendanceRecord_biometricDeviceId_fkey";

-- AddForeignKey
ALTER TABLE "BiometricPunch" ADD CONSTRAINT "BiometricPunch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
