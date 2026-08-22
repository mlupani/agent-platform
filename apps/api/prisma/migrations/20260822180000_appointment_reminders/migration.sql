-- Recordatorios automáticos de citas

CREATE TABLE "appointment_reminder_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "hoursBefore" INTEGER NOT NULL DEFAULT 24,
    "channels" TEXT[] DEFAULT ARRAY['whatsapp', 'email', 'instagram']::TEXT[],
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_reminder_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_reminder_configs_businessId_key" ON "appointment_reminder_configs"("businessId");

ALTER TABLE "appointment_reminder_configs" ADD CONSTRAINT "appointment_reminder_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "appointment_reminder_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "hoursBefore" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reminder_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_reminder_logs_appointmentId_hoursBefore_key" ON "appointment_reminder_logs"("appointmentId", "hoursBefore");
CREATE INDEX "appointment_reminder_logs_businessId_status_idx" ON "appointment_reminder_logs"("businessId", "status");

ALTER TABLE "appointment_reminder_logs" ADD CONSTRAINT "appointment_reminder_logs_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
