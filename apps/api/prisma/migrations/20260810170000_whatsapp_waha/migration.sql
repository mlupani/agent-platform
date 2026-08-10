-- Adapt WhatsAppConfig for WAHA (Meta fields become optional / legacy)
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'waha';
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "wahaBaseUrl" TEXT;
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "wahaApiKeyEnc" TEXT;
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "sessionName" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "meId" TEXT;
ALTER TABLE "whatsapp_configs" ADD COLUMN IF NOT EXISTS "sessionStatus" TEXT;

ALTER TABLE "whatsapp_configs" ALTER COLUMN "phoneNumberId" DROP NOT NULL;
ALTER TABLE "whatsapp_configs" ALTER COLUMN "verifyToken" DROP NOT NULL;

UPDATE "whatsapp_configs" SET "provider" = 'waha' WHERE "provider" IS NULL OR "provider" = '';
