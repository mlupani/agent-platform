-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contactUsername" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_businessId_channel_externalId_idx"
  ON "conversations"("businessId", "channel", "externalId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "instagram_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sessionIdEnc" TEXT,
    "username" TEXT,
    "userId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instagram_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "instagram_configs_businessId_key"
  ON "instagram_configs"("businessId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'instagram_configs_businessId_fkey'
  ) THEN
    ALTER TABLE "instagram_configs"
      ADD CONSTRAINT "instagram_configs_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
