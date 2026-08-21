-- Video shorts: mediaType + videoPrompt en generated_contents

ALTER TABLE "generated_contents" ADD COLUMN "videoPrompt" TEXT;
ALTER TABLE "generated_contents" ADD COLUMN "mediaType" TEXT NOT NULL DEFAULT 'IMAGE';
