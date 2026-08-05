-- AlterTable
ALTER TABLE "Website" ADD COLUMN "cyberScanEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CyberExternalTarget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CyberExternalTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CyberExternalTarget_url_key" ON "CyberExternalTarget"("url");
CREATE INDEX "CyberExternalTarget_enabled_idx" ON "CyberExternalTarget"("enabled");

-- Grant cybersecurity access on system profiles (merge into existing JSON)
UPDATE "Profile"
SET "permissions" = "permissions" || '{"cybersecurity":{"view":true,"modify":true,"delete":true}}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'administrateur';

UPDATE "Profile"
SET "permissions" = "permissions" || '{"cybersecurity":{"view":true,"modify":true,"delete":false}}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'operateur';

UPDATE "Profile"
SET "permissions" = "permissions" || '{"cybersecurity":{"view":true,"modify":false,"delete":false}}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'lecteur';
