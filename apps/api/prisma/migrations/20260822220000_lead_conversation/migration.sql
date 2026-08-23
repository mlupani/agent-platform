-- conversationId en leads + backfill desde metadata

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

UPDATE "leads"
SET "conversationId" = "metadata"->>'conversationId'
WHERE "conversationId" IS NULL
  AND "metadata" IS NOT NULL
  AND "metadata"->>'conversationId' IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "conversations" c
    WHERE c."id" = "leads"."metadata"->>'conversationId'
  );

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "leads_businessId_createdAt_idx"
  ON "leads"("businessId", "createdAt");
