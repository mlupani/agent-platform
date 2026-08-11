-- Content Creator (Fase 1): branding, config, generated content, assets, executions

CREATE TABLE "branding_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "visualStyle" TEXT,
    "commercialTone" TEXT,
    "targetAudience" TEXT,
    "preferNotes" TEXT,
    "avoidNotes" TEXT,
    "additionalInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branding_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "branding_configs_businessId_key" ON "branding_configs"("businessId");

ALTER TABLE "branding_configs" ADD CONSTRAINT "branding_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_content_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "defaultChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxGenerationsPerDay" INTEGER NOT NULL DEFAULT 20,
    "maxGenerationsPerMonth" INTEGER NOT NULL DEFAULT 200,
    "preferredObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_content_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_content_configs_businessId_key" ON "social_content_configs"("businessId");

ALTER TABLE "social_content_configs" ADD CONSTRAINT "social_content_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "generated_contents" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "serviceId" TEXT,
    "objective" TEXT NOT NULL,
    "topic" TEXT,
    "headline" TEXT,
    "caption" TEXT,
    "cta" TEXT,
    "userInstructions" TEXT,
    "strategy" JSONB,
    "imagePrompt" TEXT,
    "visualStyle" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generationMode" TEXT NOT NULL DEFAULT 'MANUAL',
    "error" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generated_contents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generated_contents_businessId_status_idx" ON "generated_contents"("businessId", "status");
CREATE INDEX "generated_contents_businessId_createdAt_idx" ON "generated_contents"("businessId", "createdAt");

ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_contents" ADD CONSTRAINT "generated_contents_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "content_assets" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'IMAGE',
    "format" TEXT NOT NULL,
    "aspectRatio" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "storageUrl" TEXT NOT NULL,
    "storagePublicId" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "generationPrompt" TEXT,
    "generationCost" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_assets_contentId_idx" ON "content_assets"("contentId");

ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "generated_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "content_generation_executions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contentId" TEXT,
    "stage" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCost" DECIMAL(12,6),
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_generation_executions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_generation_executions_businessId_createdAt_idx" ON "content_generation_executions"("businessId", "createdAt");
CREATE INDEX "content_generation_executions_contentId_idx" ON "content_generation_executions"("contentId");

ALTER TABLE "content_generation_executions" ADD CONSTRAINT "content_generation_executions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_generation_executions" ADD CONSTRAINT "content_generation_executions_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "generated_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
