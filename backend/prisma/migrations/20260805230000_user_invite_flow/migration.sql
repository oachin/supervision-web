-- AlterTable
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "inviteExpiresAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "inviteSentAt" TIMESTAMP(3);

-- Backfill first/last name from existing full name
UPDATE "User"
SET
  "firstName" = CASE
    WHEN trim("name") = '' THEN ''
    WHEN position(' ' in trim("name")) = 0 THEN trim("name")
    ELSE split_part(trim("name"), ' ', 1)
  END,
  "lastName" = CASE
    WHEN position(' ' in trim("name")) = 0 THEN ''
    ELSE trim(substring(trim("name") from position(' ' in trim("name")) + 1))
  END;

ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE UNIQUE INDEX "User_inviteTokenHash_key" ON "User"("inviteTokenHash");
