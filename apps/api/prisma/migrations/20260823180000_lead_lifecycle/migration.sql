ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "interest" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "objections" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "preferredChannel" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "conversionSource" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "isContactable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "leads"
SET "status" = 'contacted'
WHERE "conversationId" IS NOT NULL AND "status" = 'new';

UPDATE "leads"
SET "isContactable" = (
  ("phone" IS NOT NULL AND btrim("phone") <> '')
  OR ("email" IS NOT NULL AND btrim("email") <> '')
);

CREATE INDEX IF NOT EXISTS "leads_businessId_status_idx" ON "leads"("businessId", "status");
CREATE INDEX IF NOT EXISTS "leads_businessId_isContactable_idx" ON "leads"("businessId", "isContactable");

CREATE TABLE IF NOT EXISTS "lead_lifecycle_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "conversionMode" TEXT NOT NULL DEFAULT 'manual',
    "conversionTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followUpDelaysHours" INTEGER[] DEFAULT ARRAY[24, 72, 168]::INTEGER[],
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "generateWithAi" BOOLEAN NOT NULL DEFAULT true,
    "sendMode" TEXT NOT NULL DEFAULT 'reminder_only',
    "quietHoursStart" TEXT NOT NULL DEFAULT '09:00',
    "quietHoursEnd" TEXT NOT NULL DEFAULT '21:00',
    "timezone" TEXT,
    "preferredChannel" TEXT NOT NULL DEFAULT 'auto',
    "askForMissingContact" BOOLEAN NOT NULL DEFAULT true,
    "convertedClientStatusSlug" TEXT NOT NULL DEFAULT 'activo',
    "trialClientStatusSlug" TEXT NOT NULL DEFAULT 'visita',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_lifecycle_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_lifecycle_configs_businessId_key"
  ON "lead_lifecycle_configs"("businessId");

ALTER TABLE "lead_lifecycle_configs" DROP CONSTRAINT IF EXISTS "lead_lifecycle_configs_businessId_fkey";
ALTER TABLE "lead_lifecycle_configs"
  ADD CONSTRAINT "lead_lifecycle_configs_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "lead_follow_ups" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "conversationId" TEXT,
    "source" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "objectiveNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "channel" TEXT,
    "draftMessage" TEXT,
    "sentMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_follow_ups_businessId_status_scheduledAt_idx"
  ON "lead_follow_ups"("businessId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "lead_follow_ups_leadId_status_idx"
  ON "lead_follow_ups"("leadId", "status");

ALTER TABLE "lead_follow_ups" DROP CONSTRAINT IF EXISTS "lead_follow_ups_businessId_fkey";
ALTER TABLE "lead_follow_ups"
  ADD CONSTRAINT "lead_follow_ups_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_follow_ups" DROP CONSTRAINT IF EXISTS "lead_follow_ups_leadId_fkey";
ALTER TABLE "lead_follow_ups"
  ADD CONSTRAINT "lead_follow_ups_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_follow_ups" DROP CONSTRAINT IF EXISTS "lead_follow_ups_conversationId_fkey";
ALTER TABLE "lead_follow_ups"
  ADD CONSTRAINT "lead_follow_ups_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "lead_events" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "lead_events_leadId_createdAt_idx" ON "lead_events"("leadId", "createdAt");
CREATE INDEX IF NOT EXISTS "lead_events_businessId_idx" ON "lead_events"("businessId");

ALTER TABLE "lead_events" DROP CONSTRAINT IF EXISTS "lead_events_businessId_fkey";
ALTER TABLE "lead_events"
  ADD CONSTRAINT "lead_events_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_events" DROP CONSTRAINT IF EXISTS "lead_events_leadId_fkey";
ALTER TABLE "lead_events"
  ADD CONSTRAINT "lead_events_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
