-- AlterTable
ALTER TABLE "CyberScanSchedule" ADD COLUMN IF NOT EXISTS "autoExcludeUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
