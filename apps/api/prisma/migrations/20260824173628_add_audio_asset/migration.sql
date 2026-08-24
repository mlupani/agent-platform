-- CreateTable
CREATE TABLE "audio_assets" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceId" TEXT,
    "voiceName" TEXT,
    "text" TEXT,
    "model" TEXT,
    "storageUrl" TEXT,
    "storagePublicId" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audio_assets_contentId_idx" ON "audio_assets"("contentId");

-- CreateIndex
CREATE INDEX "audio_assets_businessId_idx" ON "audio_assets"("businessId");

-- AddForeignKey
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "generated_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
