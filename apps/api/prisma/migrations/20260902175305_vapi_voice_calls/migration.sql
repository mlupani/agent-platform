-- CreateTable
CREATE TABLE "vapi_call_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "vapiApiKeyEnc" TEXT,
    "phoneNumberId" TEXT,
    "phoneNumberE164" TEXT,
    "voiceProvider" TEXT NOT NULL DEFAULT 'vapi',
    "voiceId" TEXT NOT NULL DEFAULT 'Elliot',
    "transcriberLanguage" TEXT,
    "firstMessage" TEXT,
    "webhookSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "agentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vapi_call_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT,
    "vapiCallId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'inbound',
    "fromNumber" TEXT,
    "toNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "endedReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "costUsd" DECIMAL(12,6),
    "transcript" TEXT,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vapi_call_configs_businessId_key" ON "vapi_call_configs"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "call_logs_vapiCallId_key" ON "call_logs"("vapiCallId");

-- CreateIndex
CREATE INDEX "call_logs_businessId_createdAt_idx" ON "call_logs"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "vapi_call_configs" ADD CONSTRAINT "vapi_call_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
