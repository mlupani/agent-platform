-- Packs de clases ligados a pagos

ALTER TABLE "services"
    ADD COLUMN "sessionCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "payments"
    ADD COLUMN "serviceId" TEXT,
    ADD COLUMN "passId" TEXT,
    ADD COLUMN "sessionsGranted" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "sessionsConsumed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "service_passes" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "sessionCount" INTEGER NOT NULL,
    "sessionsPaid" INTEGER NOT NULL DEFAULT 0,
    "sessionsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_passes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_passes_businessId_userId_serviceId_idx"
    ON "service_passes"("businessId", "userId", "serviceId");

CREATE INDEX "payments_businessId_serviceId_idx" ON "payments"("businessId", "serviceId");

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_passId_fkey"
    FOREIGN KEY ("passId") REFERENCES "service_passes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_passes"
    ADD CONSTRAINT "service_passes_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_passes"
    ADD CONSTRAINT "service_passes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_passes"
    ADD CONSTRAINT "service_passes_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
