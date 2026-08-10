-- AlterTable messages
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "externalId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "messages_businessId_externalId_key" ON "messages"("businessId", "externalId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "whatsapp_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "businessAccountId" TEXT,
    "displayPhoneNumber" TEXT,
    "verifyToken" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_configs_businessId_key" ON "whatsapp_configs"("businessId");

ALTER TABLE "whatsapp_configs" DROP CONSTRAINT IF EXISTS "whatsapp_configs_businessId_fkey";
ALTER TABLE "whatsapp_configs" ADD CONSTRAINT "whatsapp_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
