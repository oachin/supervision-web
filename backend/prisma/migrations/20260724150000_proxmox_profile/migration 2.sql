-- AlterEnum
ALTER TYPE "AgentProfile" ADD VALUE 'PROXMOX';

-- CreateTable
CREATE TABLE "ProxmoxVm" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "vmid" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cpus" INTEGER NOT NULL,
    "maxmemMb" DOUBLE PRECISION NOT NULL,
    "maxdiskGb" DOUBLE PRECISION NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxmoxVm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProxmoxVmMetric" (
    "id" TEXT NOT NULL,
    "vmId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memUsedMb" DOUBLE PRECISION NOT NULL,
    "memTotalMb" DOUBLE PRECISION NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxmoxVmMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProxmoxBackup" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "upid" TEXT NOT NULL,
    "vmid" INTEGER,
    "vmName" TEXT,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "error" TEXT,
    "sizeBytes" BIGINT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxmoxBackup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProxmoxVm_serverId_vmid_key" ON "ProxmoxVm"("serverId", "vmid");
CREATE INDEX "ProxmoxVm_serverId_idx" ON "ProxmoxVm"("serverId");
CREATE INDEX "ProxmoxVmMetric_vmId_collectedAt_idx" ON "ProxmoxVmMetric"("vmId", "collectedAt");
CREATE UNIQUE INDEX "ProxmoxBackup_serverId_upid_key" ON "ProxmoxBackup"("serverId", "upid");
CREATE INDEX "ProxmoxBackup_serverId_startedAt_idx" ON "ProxmoxBackup"("serverId", "startedAt");
CREATE INDEX "ProxmoxBackup_serverId_status_idx" ON "ProxmoxBackup"("serverId", "status");

ALTER TABLE "ProxmoxVm" ADD CONSTRAINT "ProxmoxVm_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProxmoxVmMetric" ADD CONSTRAINT "ProxmoxVmMetric_vmId_fkey" FOREIGN KEY ("vmId") REFERENCES "ProxmoxVm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProxmoxBackup" ADD CONSTRAINT "ProxmoxBackup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
