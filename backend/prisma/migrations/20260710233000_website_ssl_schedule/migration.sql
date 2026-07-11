-- Fréquence SSL : champ lastSslCheckAt + resynchronisation statuts incohérents
ALTER TABLE "Website" ADD COLUMN "lastSslCheckAt" TIMESTAMP(3);

UPDATE "Website"
SET status = "externalStatus", "internalStatus" = 'UNKNOWN'
WHERE "externalStatus" = 'UP' AND status = 'DOWN';
