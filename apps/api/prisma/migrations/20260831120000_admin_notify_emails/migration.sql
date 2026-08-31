-- Varios emails destino para avisos de operaciones sensibles

ALTER TABLE "admin_notify_configs" ADD COLUMN "emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "admin_notify_configs"
SET "emails" = ARRAY["email"]
WHERE "email" IS NOT NULL AND btrim("email") <> '';

ALTER TABLE "admin_notify_configs" DROP COLUMN "email";
