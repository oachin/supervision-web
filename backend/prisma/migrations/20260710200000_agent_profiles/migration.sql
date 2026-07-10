-- AlterTable Server: profil agent
CREATE TYPE "AgentProfile" AS ENUM ('LINUX', 'PLESK');

ALTER TABLE "Server" ADD COLUMN "profile" "AgentProfile" NOT NULL DEFAULT 'LINUX';

UPDATE "Server" SET "profile" = 'PLESK' WHERE "hasPlesk" = true;

-- AlterTable Website: source de création
ALTER TABLE "Website" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
