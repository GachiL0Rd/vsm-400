/*
  Warnings:

  - A unique constraint covering the columns `[dedupKey]` on the table `notification` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[startsAt]` on the table `season` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "dedupKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupKey_key" ON "notification"("dedupKey");

-- CreateIndex
CREATE UNIQUE INDEX "season_startsAt_key" ON "season"("startsAt");
