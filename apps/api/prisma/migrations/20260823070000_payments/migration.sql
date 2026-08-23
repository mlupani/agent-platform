-- Pagos de clientes

CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_businessId_paidAt_idx" ON "payments"("businessId", "paidAt");
CREATE INDEX "payments_businessId_userId_idx" ON "payments"("businessId", "userId");

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
