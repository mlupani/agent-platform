-- Avisos por email al negocio (agenda, leads, clientes automáticos)

CREATE TABLE "admin_notify_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "events" TEXT[] DEFAULT ARRAY['appointment.created', 'lead.created', 'client.auto_created']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_notify_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admin_notify_configs_businessId_key" ON "admin_notify_configs"("businessId");

ALTER TABLE "admin_notify_configs" ADD CONSTRAINT "admin_notify_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
