-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "baseRole" "Role" NOT NULL DEFAULT 'VIEWER',
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_name_key" ON "Profile"("name");
CREATE UNIQUE INDEX "Profile_slug_key" ON "Profile"("slug");

-- Seed system profiles
INSERT INTO "Profile" ("id", "name", "slug", "description", "isSystem", "baseRole", "permissions", "createdAt", "updatedAt")
VALUES
(
  'profile-admin-system',
  'Administrateur',
  'administrateur',
  'Accès complet à la plateforme',
  true,
  'ADMIN',
  '{
    "dashboard":{"view":true,"modify":true,"delete":true},
    "servers":{"view":true,"modify":true,"delete":true},
    "vms":{"view":true,"modify":true,"delete":true},
    "websites":{"view":true,"modify":true,"delete":true},
    "alerts":{"view":true,"modify":true,"delete":true},
    "events":{"view":true,"modify":false,"delete":false},
    "settings":{"view":true,"modify":true,"delete":true},
    "users":{"view":true,"modify":true,"delete":true},
    "profiles":{"view":true,"modify":true,"delete":true},
    "notifications":{"view":true,"modify":true,"delete":true}
  }'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'profile-operator-system',
  'Opérateur',
  'operateur',
  'Supervision opérationnelle sans administration des accès',
  true,
  'OPERATOR',
  '{
    "dashboard":{"view":true,"modify":false,"delete":false},
    "servers":{"view":true,"modify":true,"delete":false},
    "vms":{"view":true,"modify":true,"delete":false},
    "websites":{"view":true,"modify":true,"delete":false},
    "alerts":{"view":true,"modify":true,"delete":false},
    "events":{"view":true,"modify":false,"delete":false},
    "settings":{"view":true,"modify":false,"delete":false},
    "users":{"view":false,"modify":false,"delete":false},
    "profiles":{"view":false,"modify":false,"delete":false},
    "notifications":{"view":true,"modify":false,"delete":false}
  }'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'profile-viewer-system',
  'Lecteur',
  'lecteur',
  'Lecture seule des écrans de supervision',
  true,
  'VIEWER',
  '{
    "dashboard":{"view":true,"modify":false,"delete":false},
    "servers":{"view":true,"modify":false,"delete":false},
    "vms":{"view":true,"modify":false,"delete":false},
    "websites":{"view":true,"modify":false,"delete":false},
    "alerts":{"view":true,"modify":false,"delete":false},
    "events":{"view":true,"modify":false,"delete":false},
    "settings":{"view":false,"modify":false,"delete":false},
    "users":{"view":false,"modify":false,"delete":false},
    "profiles":{"view":false,"modify":false,"delete":false},
    "notifications":{"view":false,"modify":false,"delete":false}
  }'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "profileId" TEXT;

UPDATE "User" SET "profileId" = CASE
  WHEN "role" = 'ADMIN' THEN 'profile-admin-system'
  WHEN "role" = 'OPERATOR' THEN 'profile-operator-system'
  ELSE 'profile-viewer-system'
END;

ALTER TABLE "User" ALTER COLUMN "profileId" SET NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "User_profileId_idx" ON "User"("profileId");
