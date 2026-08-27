/*
  Warnings:

  - You are about to drop the column `companyId` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `parentOrganizationId` on the `Organization` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Organization" DROP CONSTRAINT "Organization_parentOrganizationId_fkey";

-- DropIndex
DROP INDEX "Organization_companyId_idx";

-- DropIndex
DROP INDEX "Organization_parentOrganizationId_idx";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "companyId",
DROP COLUMN "parentOrganizationId";
