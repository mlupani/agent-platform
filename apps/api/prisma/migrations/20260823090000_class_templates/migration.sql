-- Cupo de clases grupales y grilla semanal

ALTER TABLE "services"
    ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "class_templates" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "capacity" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "class_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "class_templates_businessId_dayOfWeek_startTime_key"
    ON "class_templates"("businessId", "dayOfWeek", "startTime");

CREATE INDEX "class_templates_businessId_idx" ON "class_templates"("businessId");

CREATE INDEX "class_templates_businessId_serviceId_idx"
    ON "class_templates"("businessId", "serviceId");

ALTER TABLE "class_templates"
    ADD CONSTRAINT "class_templates_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "class_templates"
    ADD CONSTRAINT "class_templates_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
