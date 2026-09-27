-- CreateEnum
CREATE TYPE "text_variant_reason" AS ENUM ('SEED', 'REFILL', 'LIVE', 'MANUAL');

-- AlterTable
ALTER TABLE "scenario_text_variant" ADD COLUMN "sessionId" UUID,
ADD COLUMN "reason" "text_variant_reason" NOT NULL DEFAULT 'SEED';

-- CreateIndex
CREATE INDEX "scenario_text_variant_sessionId_idx" ON "scenario_text_variant"("sessionId");

-- AddForeignKey
ALTER TABLE "scenario_text_variant" ADD CONSTRAINT "scenario_text_variant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
