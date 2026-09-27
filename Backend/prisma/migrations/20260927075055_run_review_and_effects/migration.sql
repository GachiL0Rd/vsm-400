-- AlterTable
ALTER TABLE "run" ADD COLUMN     "effectsAt" TIMESTAMP(3),
ADD COLUMN     "reviewApproved" BOOLEAN,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- CreateIndex
CREATE INDEX "run_reviewedById_idx" ON "run"("reviewedById");

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
