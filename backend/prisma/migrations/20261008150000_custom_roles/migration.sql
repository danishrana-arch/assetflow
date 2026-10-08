-- Control Center custom roles: a named module set layered on a base role.
CREATE TABLE "CustomRole" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "baseRole" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
  "modules" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomRole_key_key" ON "CustomRole"("key");

ALTER TABLE "User" ADD COLUMN "customRoleId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "CustomRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
