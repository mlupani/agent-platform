-- AlterTable conversations
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "unreadCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessagePreview" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageSender" TEXT;

CREATE INDEX IF NOT EXISTS "conversations_businessId_lastMessageAt_idx" ON "conversations"("businessId", "lastMessageAt");

-- AlterTable messages
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sender" TEXT NOT NULL DEFAULT 'CLIENT';
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" TEXT;
