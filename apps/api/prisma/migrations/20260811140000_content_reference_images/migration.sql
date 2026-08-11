-- Reference images for content generation context

ALTER TABLE "generated_contents" ADD COLUMN "referenceImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
