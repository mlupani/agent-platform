-- AlterTable
ALTER TABLE "lead_follow_ups" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "lead_lifecycle_configs" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "social_content_configs" ADD COLUMN     "preferredVideoModel" TEXT,
ADD COLUMN     "preferredVideoProvider" TEXT;
