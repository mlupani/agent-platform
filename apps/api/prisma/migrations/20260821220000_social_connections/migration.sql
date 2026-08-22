-- Zernio profile por tenant + cuentas sociales Instagram/TikTok

ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "zernioProfileId" TEXT;

CREATE TABLE IF NOT EXISTS "social_connections" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'zernio',
    "platform" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "zernioProfileId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "social_connections_businessId_provider_platform_key"
  ON "social_connections"("businessId", "provider", "platform");

CREATE UNIQUE INDEX IF NOT EXISTS "social_connections_provider_externalAccountId_key"
  ON "social_connections"("provider", "externalAccountId");

CREATE INDEX IF NOT EXISTS "social_connections_businessId_platform_idx"
  ON "social_connections"("businessId", "platform");

CREATE INDEX IF NOT EXISTS "social_connections_zernioProfileId_idx"
  ON "social_connections"("zernioProfileId");

ALTER TABLE "social_connections"
  DROP CONSTRAINT IF EXISTS "social_connections_businessId_fkey";

ALTER TABLE "social_connections"
  ADD CONSTRAINT "social_connections_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
