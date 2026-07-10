-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');
CREATE TYPE "ServerStatus" AS ENUM ('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN');
CREATE TYPE "WebsiteStatus" AS ENUM ('UP', 'DOWN', 'DEGRADED', 'UNKNOWN');
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpBackupCodes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "ipAddress" TEXT,
    "osType" TEXT NOT NULL DEFAULT 'linux',
    "osVersion" TEXT,
    "hasPlesk" BOOLEAN NOT NULL DEFAULT false,
    "pleskUrl" TEXT,
    "pleskApiKey" TEXT,
    "agentKey" TEXT NOT NULL,
    "status" "ServerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "tags" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServerMetric" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryPercent" DOUBLE PRECISION NOT NULL,
    "memoryUsedMb" DOUBLE PRECISION NOT NULL,
    "memoryTotalMb" DOUBLE PRECISION NOT NULL,
    "diskPercent" DOUBLE PRECISION NOT NULL,
    "diskUsedGb" DOUBLE PRECISION NOT NULL,
    "diskTotalGb" DOUBLE PRECISION NOT NULL,
    "loadAvg1" DOUBLE PRECISION NOT NULL,
    "loadAvg5" DOUBLE PRECISION NOT NULL,
    "loadAvg15" DOUBLE PRECISION NOT NULL,
    "uptimeSeconds" INTEGER NOT NULL,
    "pleskDomains" INTEGER,
    "pleskServices" JSONB,
    "rawData" JSONB,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "serverId" TEXT,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'UNKNOWN',
    "checkInterval" INTEGER NOT NULL DEFAULT 60,
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "expectedKeyword" TEXT,
    "sslEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sslExpiresAt" TIMESTAMP(3),
    "lastCheckAt" TIMESTAMP(3),
    "lastResponseMs" INTEGER,
    "lastStatusCode" INTEGER,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebsiteCheck" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "status" "WebsiteStatus" NOT NULL,
    "statusCode" INTEGER,
    "responseMs" INTEGER,
    "sslValid" BOOLEAN,
    "sslExpiresAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebsiteCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "serverId" TEXT,
    "websiteId" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE UNIQUE INDEX "Server_agentKey_key" ON "Server"("agentKey");
CREATE INDEX "Server_status_idx" ON "Server"("status");
CREATE INDEX "ServerMetric_serverId_collectedAt_idx" ON "ServerMetric"("serverId", "collectedAt");
CREATE INDEX "Website_status_idx" ON "Website"("status");
CREATE INDEX "WebsiteCheck_websiteId_checkedAt_idx" ON "WebsiteCheck"("websiteId", "checkedAt");
CREATE INDEX "Alert_resolved_createdAt_idx" ON "Alert"("resolved", "createdAt");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServerMetric" ADD CONSTRAINT "ServerMetric_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Website" ADD CONSTRAINT "Website_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebsiteCheck" ADD CONSTRAINT "WebsiteCheck_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
