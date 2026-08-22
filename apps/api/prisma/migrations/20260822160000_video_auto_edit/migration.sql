-- Auto-edición de videos: hook/hashtags + estado FFmpeg + asset original vs final

ALTER TABLE "generated_contents" ADD COLUMN "hook" TEXT;
ALTER TABLE "generated_contents" ADD COLUMN "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "generated_contents" ADD COLUMN "autoEditStatus" TEXT;
ALTER TABLE "generated_contents" ADD COLUMN "autoEditError" TEXT;

ALTER TABLE "content_assets" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'ORIGINAL';
