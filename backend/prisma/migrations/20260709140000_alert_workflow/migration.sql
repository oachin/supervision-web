-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'PENDING_CLOSE', 'CLOSED');

-- AlterTable Alert
ALTER TABLE "Alert" ADD COLUMN "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Alert" ADD COLUMN "occurrenceCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Alert" ADD COLUMN "fingerprint" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Alert" ADD COLUMN "acknowledgedById" TEXT;
ALTER TABLE "Alert" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Alert" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "Alert" ADD COLUMN "issueResolvedAt" TIMESTAMP(3);
ALTER TABLE "Alert" ADD COLUMN "origin" TEXT;
ALTER TABLE "Alert" ADD COLUMN "resolutionMethod" TEXT;
ALTER TABLE "Alert" ADD COLUMN "closedById" TEXT;
ALTER TABLE "Alert" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "Alert" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill fingerprint for existing rows
UPDATE "Alert" SET "fingerprint" = md5("title" || COALESCE("serverId", '') || COALESCE("websiteId", ''));
UPDATE "Alert" SET "status" = 'CLOSED' WHERE "resolved" = true;
UPDATE "Alert" SET "status" = 'ACKNOWLEDGED' WHERE "acknowledged" = true AND "resolved" = false;

-- CreateTable AlertEvent
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_status_createdAt_idx" ON "Alert"("status", "createdAt");
CREATE INDEX "Alert_fingerprint_idx" ON "Alert"("fingerprint");
CREATE INDEX "AlertEvent_alertId_createdAt_idx" ON "AlertEvent"("alertId", "createdAt");
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
