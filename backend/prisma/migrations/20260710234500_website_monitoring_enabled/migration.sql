ALTER TABLE "Website" ADD COLUMN "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Website_monitoringEnabled_idx" ON "Website"("monitoringEnabled");
