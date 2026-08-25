-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "isTrial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "servicePassId" TEXT;

-- AlterTable
ALTER TABLE "service_passes" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "hasUsedTrial" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "class_credit_movements" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "servicePassId" TEXT,
    "appointmentId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_credit_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_credit_movements_businessId_userId_idx" ON "class_credit_movements"("businessId", "userId");

-- CreateIndex
CREATE INDEX "class_credit_movements_servicePassId_idx" ON "class_credit_movements"("servicePassId");

-- CreateIndex
CREATE INDEX "class_credit_movements_appointmentId_idx" ON "class_credit_movements"("appointmentId");

-- CreateIndex
CREATE INDEX "appointments_businessId_userId_idx" ON "appointments"("businessId", "userId");

-- CreateIndex
CREATE INDEX "service_passes_businessId_userId_idx" ON "service_passes"("businessId", "userId");

-- CreateIndex
CREATE INDEX "users_businessId_phone_idx" ON "users"("businessId", "phone");

-- AddForeignKey
ALTER TABLE "class_credit_movements" ADD CONSTRAINT "class_credit_movements_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_credit_movements" ADD CONSTRAINT "class_credit_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_credit_movements" ADD CONSTRAINT "class_credit_movements_servicePassId_fkey" FOREIGN KEY ("servicePassId") REFERENCES "service_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_credit_movements" ADD CONSTRAINT "class_credit_movements_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_servicePassId_fkey" FOREIGN KEY ("servicePassId") REFERENCES "service_passes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
