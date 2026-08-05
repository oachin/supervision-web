-- CreateTable
CREATE TABLE "CyberScanSchedule" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyTimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deep" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "lastRunAt" TIMESTAMP(3),
    "lastTrigger" TEXT,
    "lastDailySlot" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CyberScanSchedule_pkey" PRIMARY KEY ("id")
);

INSERT INTO "CyberScanSchedule" ("id", "enabled", "intervalMinutes", "dailyTimes", "deep", "timezone", "updatedAt")
VALUES ('default', false, 0, ARRAY[]::TEXT[], false, 'Europe/Paris', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
