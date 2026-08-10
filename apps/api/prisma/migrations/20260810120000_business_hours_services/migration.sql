-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "instagram" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "additionalInfo" TEXT;

-- AlterTable
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "tone" TEXT NOT NULL DEFAULT 'professional_warm';
ALTER TABLE "agent_configs" ADD COLUMN IF NOT EXISTS "customInstructions" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "business_hours" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "ranges" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "business_hours_businessId_dayOfWeek_key" ON "business_hours"("businessId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "business_hours_businessId_idx" ON "business_hours"("businessId");

ALTER TABLE "business_hours" DROP CONSTRAINT IF EXISTS "business_hours_businessId_fkey";
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "services" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "price" DECIMAL(12,2),
    "priceDescription" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requiresAppointment" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "services_businessId_enabled_idx" ON "services"("businessId", "enabled");

ALTER TABLE "services" DROP CONSTRAINT IF EXISTS "services_businessId_fkey";
ALTER TABLE "services" ADD CONSTRAINT "services_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
