-- Estados de cliente (aux) + vínculo en users

CREATE TABLE "client_statuses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "client_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_statuses_slug_key" ON "client_statuses"("slug");

INSERT INTO "client_statuses" ("id", "slug", "name", "sortOrder") VALUES
    ('status-activo', 'activo', 'Activo', 1),
    ('status-inactivo', 'inactivo', 'Inactivo', 2),
    ('status-visita', 'visita', 'Visita', 3);

ALTER TABLE "users" ADD COLUMN "notes" TEXT;
ALTER TABLE "users" ADD COLUMN "statusId" TEXT NOT NULL DEFAULT 'status-activo';

ALTER TABLE "users"
    ADD CONSTRAINT "users_statusId_fkey"
    FOREIGN KEY ("statusId") REFERENCES "client_statuses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_businessId_statusId_idx" ON "users"("businessId", "statusId");
