-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "hiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "conversations_businessId_hiddenAt_idx"
  ON "conversations"("businessId", "hiddenAt");
