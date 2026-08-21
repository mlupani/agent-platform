-- Avisos de generación automática (WhatsApp o email)

ALTER TABLE "social_content_configs" ADD COLUMN IF NOT EXISTS "notifyWhatsAppPhone" TEXT;
ALTER TABLE "social_content_configs" ADD COLUMN IF NOT EXISTS "notifyEmail" TEXT;

