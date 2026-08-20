-- CreateTable
CREATE TABLE IF NOT EXISTS "web_chat_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyHash" TEXT,
    "apiKeyPrefix" TEXT,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_chat_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "web_chat_configs_businessId_key"
  ON "web_chat_configs"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "web_chat_configs_apiKeyHash_key"
  ON "web_chat_configs"("apiKeyHash");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'web_chat_configs_businessId_fkey'
  ) THEN
    ALTER TABLE "web_chat_configs"
      ADD CONSTRAINT "web_chat_configs_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
