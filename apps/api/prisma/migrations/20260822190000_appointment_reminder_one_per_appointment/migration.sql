-- Un solo recordatorio por cita (evita duplicados si cambia hoursBefore)

DELETE FROM "appointment_reminder_logs" a
USING "appointment_reminder_logs" b
WHERE a."appointmentId" = b."appointmentId"
  AND a."id" <> b."id"
  AND (
    a."createdAt" < b."createdAt"
    OR (a."createdAt" = b."createdAt" AND a."id" < b."id")
  );

DROP INDEX IF EXISTS "appointment_reminder_logs_appointmentId_hoursBefore_key";

CREATE UNIQUE INDEX "appointment_reminder_logs_appointmentId_key"
  ON "appointment_reminder_logs"("appointmentId");
