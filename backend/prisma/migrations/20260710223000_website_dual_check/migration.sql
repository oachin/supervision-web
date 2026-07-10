-- CreateEnum
CREATE TYPE "WebsiteCheckMode" AS ENUM ('EXTERNAL', 'INTERNAL', 'BOTH');
CREATE TYPE "WebsiteCheckSource" AS ENUM ('EXTERNAL', 'INTERNAL');

-- AlterTable
ALTER TABLE "Website" ADD COLUMN "checkMode" "WebsiteCheckMode" NOT NULL DEFAULT 'EXTERNAL';
ALTER TABLE "Website" ADD COLUMN "externalStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Website" ADD COLUMN "internalStatus" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Website" ADD COLUMN "lastExternalCheckAt" TIMESTAMP(3);
ALTER TABLE "Website" ADD COLUMN "lastInternalCheckAt" TIMESTAMP(3);
ALTER TABLE "Website" ADD COLUMN "lastExternalResponseMs" INTEGER;
ALTER TABLE "Website" ADD COLUMN "lastInternalResponseMs" INTEGER;
ALTER TABLE "Website" ADD COLUMN "lastExternalStatusCode" INTEGER;
ALTER TABLE "Website" ADD COLUMN "lastInternalStatusCode" INTEGER;

ALTER TABLE "WebsiteCheck" ADD COLUMN "checkSource" "WebsiteCheckSource" NOT NULL DEFAULT 'EXTERNAL';

-- Agent-imported sites: dual supervision
UPDATE "Website" SET "checkMode" = 'BOTH' WHERE "source" = 'agent';

-- Backfill external status from current status
UPDATE "Website" SET "externalStatus" = "status";

-- CreateIndex
CREATE INDEX "Website_externalStatus_idx" ON "Website"("externalStatus");
CREATE INDEX "Website_internalStatus_idx" ON "Website"("internalStatus");
CREATE INDEX "WebsiteCheck_websiteId_checkSource_checkedAt_idx" ON "WebsiteCheck"("websiteId", "checkSource", "checkedAt");
