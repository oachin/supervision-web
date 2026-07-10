-- Website external monitoring fields
ALTER TABLE "Website" ADD COLUMN "sslAlertDays" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Website" ADD COLUMN "lastDnsOk" BOOLEAN;
ALTER TABLE "Website" ADD COLUMN "lastPort443Open" BOOLEAN;
ALTER TABLE "Website" ADD COLUMN "lastTlsVersion" TEXT;
ALTER TABLE "Website" ADD COLUMN "sslIssuer" TEXT;
ALTER TABLE "Website" ADD COLUMN "sslSubject" TEXT;
ALTER TABLE "Website" ADD COLUMN "sslDaysRemaining" INTEGER;

ALTER TABLE "WebsiteCheck" ADD COLUMN "dnsOk" BOOLEAN;
ALTER TABLE "WebsiteCheck" ADD COLUMN "port443Open" BOOLEAN;
ALTER TABLE "WebsiteCheck" ADD COLUMN "tlsVersion" TEXT;
ALTER TABLE "WebsiteCheck" ADD COLUMN "sslIssuer" TEXT;
ALTER TABLE "WebsiteCheck" ADD COLUMN "sslSubject" TEXT;
ALTER TABLE "WebsiteCheck" ADD COLUMN "sslDaysRemaining" INTEGER;
ALTER TABLE "WebsiteCheck" ADD COLUMN "sslChainValid" BOOLEAN;

UPDATE "Website" SET "checkMode" = 'EXTERNAL' WHERE "checkMode" IN ('BOTH', 'INTERNAL');
