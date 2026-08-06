-- AlterTable
ALTER TABLE "Server" ADD COLUMN IF NOT EXISTS "pleskExcludedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
