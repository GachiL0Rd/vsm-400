-- CreateEnum
CREATE TYPE "text_variant_status" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED');

-- AlterTable
ALTER TABLE "game_session" ADD COLUMN     "textPlan" JSONB;

-- CreateTable
CREATE TABLE "scenario_text_variant" (
    "id" UUID NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nodeId" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "text_variant_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "maxUses" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,

    CONSTRAINT "scenario_text_variant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scenario_text_variant_scenarioId_version_nodeId_status_idx" ON "scenario_text_variant"("scenarioId", "version", "nodeId", "status");

-- CreateIndex
CREATE INDEX "scenario_text_variant_reviewedById_idx" ON "scenario_text_variant"("reviewedById");

-- AddForeignKey
ALTER TABLE "scenario_text_variant" ADD CONSTRAINT "scenario_text_variant_scenarioId_version_fkey" FOREIGN KEY ("scenarioId", "version") REFERENCES "scenario_version"("scenarioId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_text_variant" ADD CONSTRAINT "scenario_text_variant_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
