-- CreateTable
CREATE TABLE "game_telemetry" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAt" TIMESTAMP(3),

    CONSTRAINT "game_telemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "game_telemetry_sessionId_seq_key" ON "game_telemetry"("sessionId", "seq");

-- AddForeignKey
ALTER TABLE "game_telemetry" ADD CONSTRAINT "game_telemetry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Телеметрия больше не делит seq с журналом решений.
INSERT INTO "game_telemetry" ("sessionId", "seq", "type", "payload", "serverAt", "clientAt")
SELECT "sessionId", "seq", "type", "payload", "serverAt", "clientAt"
FROM "game_event"
WHERE "type" <> 'decision';

DELETE FROM "game_event"
WHERE "type" <> 'decision';
