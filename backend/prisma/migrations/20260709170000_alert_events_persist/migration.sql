-- AlterTable AlertEvent: conserver les évènements quand l'alerte est supprimée
ALTER TABLE "AlertEvent" DROP CONSTRAINT IF EXISTS "AlertEvent_alertId_fkey";
ALTER TABLE "AlertEvent" ALTER COLUMN "alertId" DROP NOT NULL;
ALTER TABLE "AlertEvent" ADD COLUMN IF NOT EXISTS "alertTitle" TEXT;
ALTER TABLE "AlertEvent" ADD COLUMN IF NOT EXISTS "alertSeverity" TEXT;
ALTER TABLE "AlertEvent" ADD COLUMN IF NOT EXISTS "resourceName" TEXT;
ALTER TABLE "AlertEvent" ADD COLUMN IF NOT EXISTS "resourceType" TEXT;
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Snapshot des évènements existants avant nettoyage des alertes orphelines
UPDATE "AlertEvent" e
SET
  "alertTitle" = a."title",
  "alertSeverity" = a."severity"::text
FROM "Alert" a
WHERE e."alertId" = a."id" AND e."alertTitle" IS NULL;

-- Supprimer les alertes orphelines (ressource déjà supprimée)
DELETE FROM "Alert"
WHERE "websiteId" IS NULL
  AND "serverId" IS NULL
  AND "status" != 'CLOSED';
