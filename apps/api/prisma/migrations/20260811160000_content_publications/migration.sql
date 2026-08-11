-- Content publications per channel (WhatsApp Status / Instagram Story / Feed)

CREATE TABLE "content_publications" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_publications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_publications_contentId_idx" ON "content_publications"("contentId");
CREATE INDEX "content_publications_businessId_channel_idx" ON "content_publications"("businessId", "channel");

ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_publications" ADD CONSTRAINT "content_publications_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "generated_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
