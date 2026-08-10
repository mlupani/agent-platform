-- CreateTable
CREATE TABLE IF NOT EXISTS "google_calendar_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "refreshTokenEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastError" TEXT,
    "connectedEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_calendar_configs_businessId_key" ON "google_calendar_configs"("businessId");

ALTER TABLE "google_calendar_configs" DROP CONSTRAINT IF EXISTS "google_calendar_configs_businessId_fkey";
ALTER TABLE "google_calendar_configs" ADD CONSTRAINT "google_calendar_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "appointments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "googleEventId" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "appointments_businessId_startsAt_idx" ON "appointments"("businessId", "startsAt");
CREATE INDEX IF NOT EXISTS "appointments_businessId_status_idx" ON "appointments"("businessId", "status");
CREATE INDEX IF NOT EXISTS "appointments_businessId_contactPhone_idx" ON "appointments"("businessId", "contactPhone");

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_businessId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_serviceId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_conversationId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "appointments_userId_fkey";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
