-- CreateEnum
CREATE TYPE "role" AS ENUM ('CONDUCTOR', 'CHIEF', 'METHODIST', 'ADMIN');

-- CreateEnum
CREATE TYPE "grade" AS ENUM ('TRAINEE', 'CONDUCTOR', 'CONDUCTOR_SENIOR', 'INSTRUCTOR');

-- CreateEnum
CREATE TYPE "car_class" AS ENUM ('ECONOMY', 'FAMILY', 'BUSINESS', 'FIRST');

-- CreateEnum
CREATE TYPE "competency" AS ENUM ('safety', 'procedure', 'detection', 'reaction', 'service', 'escalation');

-- CreateEnum
CREATE TYPE "stage" AS ENUM ('acceptance', 'boarding', 'enroute', 'stop', 'handover');

-- CreateEnum
CREATE TYPE "run_outcome" AS ENUM ('completed', 'incident', 'terminated');

-- CreateEnum
CREATE TYPE "verdict" AS ENUM ('best', 'ok', 'worse', 'missed');

-- CreateEnum
CREATE TYPE "scenario_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "shift_status" AS ENUM ('PLANNED', 'STARTED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "game_session_status" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'ABORTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "transport" AS ENUM ('REST', 'WS');

-- CreateEnum
CREATE TYPE "webhook_delivery_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ledger_reason" AS ENUM ('RUN', 'ACHIEVEMENT', 'CHALLENGE', 'EXPIRE', 'ADJUST');

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('expiring', 'scenario', 'challenge', 'overtaken', 'advice', 'achievement', 'promotion', 'assignment');

-- CreateEnum
CREATE TYPE "promotion_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'API_CLIENT', 'SYSTEM', 'GAME_SERVER');

-- CreateTable
CREATE TABLE "depot" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,

    CONSTRAINT "depot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brigade" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "depotId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "brigade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "callsign" VARCHAR(4) NOT NULL,
    "extHash" TEXT,
    "position" TEXT NOT NULL,
    "grade" "grade" NOT NULL,
    "brigadeId" UUID,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRunAt" TIMESTAMP(3),
    "streakDays" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_client" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscription" (
    "id" UUID NOT NULL,
    "apiClientId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "webhook_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "carClasses" "car_class"[],
    "difficulty" INTEGER NOT NULL,
    "competencies" "competency"[],
    "status" "scenario_status" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenario_version" (
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "scenario_version_pkey" PRIMARY KEY ("scenarioId","version")
);

-- CreateTable
CREATE TABLE "shift_assignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assignedById" UUID,
    "train" TEXT NOT NULL,
    "fromStation" TEXT NOT NULL,
    "toStation" TEXT NOT NULL,
    "stops" TEXT[],
    "car" INTEGER NOT NULL,
    "carClass" "car_class" NOT NULL,
    "departureAt" TIMESTAMP(3) NOT NULL,
    "focus" "competency"[],
    "scenarioIds" TEXT[],
    "status" "shift_status" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "shiftId" UUID,
    "status" "game_session_status" NOT NULL DEFAULT 'PENDING',
    "transport" "transport" NOT NULL,
    "plan" JSONB NOT NULL,
    "seedCommit" TEXT NOT NULL,
    "seedEnc" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "nodeDeadlineAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "flags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_event" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientAt" TIMESTAMP(3),

    CONSTRAINT "game_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "train" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "car" INTEGER NOT NULL,
    "carClass" "car_class" NOT NULL,
    "outcome" "run_outcome" NOT NULL,
    "outcomeNote" TEXT NOT NULL,
    "loyalty" INTEGER NOT NULL,
    "safety" INTEGER NOT NULL,
    "politeness" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "playSeconds" INTEGER NOT NULL,
    "competencyDelta" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "finishedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_decision" (
    "id" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "idx" INTEGER NOT NULL,
    "gameTime" TEXT NOT NULL,
    "stage" "stage" NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "choiceId" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "verdict" "verdict" NOT NULL,
    "loyaltyDelta" INTEGER NOT NULL,
    "safetyDelta" INTEGER NOT NULL,
    "reactionMs" INTEGER,
    "consequence" TEXT,
    "lucky" BOOLEAN NOT NULL DEFAULT false,
    "better" TEXT,
    "basis" TEXT,
    "deviation" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "run_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_score" (
    "userId" UUID NOT NULL,
    "competency" "competency" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competency_score_pkey" PRIMARY KEY ("userId","competency")
);

-- CreateTable
CREATE TABLE "point_ledger" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "ledger_reason" NOT NULL,
    "runId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),

    CONSTRAINT "point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievement" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rule" JSONB NOT NULL,
    "total" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "achievement_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "user_achievement" (
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "earnedAt" TIMESTAMP(3),

    CONSTRAINT "user_achievement_pkey" PRIMARY KEY ("userId","code")
);

-- CreateTable
CREATE TABLE "season" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "season_score" (
    "seasonId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "season_score_pkey" PRIMARY KEY ("seasonId","userId")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_recommendation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fromGrade" "grade" NOT NULL,
    "toGrade" "grade" NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "promotion_status" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "promotion_recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actorType" "actor_type" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "depot_code_key" ON "depot"("code");

-- CreateIndex
CREATE INDEX "brigade_depotId_idx" ON "brigade"("depotId");

-- CreateIndex
CREATE UNIQUE INDEX "brigade_depotId_code_key" ON "brigade"("depotId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "user_login_key" ON "user"("login");

-- CreateIndex
CREATE UNIQUE INDEX "user_callsign_key" ON "user"("callsign");

-- CreateIndex
CREATE UNIQUE INDEX "user_extHash_key" ON "user"("extHash");

-- CreateIndex
CREATE INDEX "user_brigadeId_idx" ON "user"("brigadeId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refreshHash_key" ON "auth_session"("refreshHash");

-- CreateIndex
CREATE INDEX "auth_session_userId_idx" ON "auth_session"("userId");

-- CreateIndex
CREATE INDEX "auth_session_replacedById_idx" ON "auth_session"("replacedById");

-- CreateIndex
CREATE UNIQUE INDEX "api_client_keyHash_key" ON "api_client"("keyHash");

-- CreateIndex
CREATE INDEX "webhook_subscription_apiClientId_idx" ON "webhook_subscription"("apiClientId");

-- CreateIndex
CREATE INDEX "webhook_delivery_subscriptionId_idx" ON "webhook_delivery"("subscriptionId");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "scenario_version_createdById_idx" ON "scenario_version"("createdById");

-- CreateIndex
CREATE INDEX "shift_assignment_userId_status_idx" ON "shift_assignment"("userId", "status");

-- CreateIndex
CREATE INDEX "shift_assignment_assignedById_idx" ON "shift_assignment"("assignedById");

-- CreateIndex
CREATE INDEX "game_session_userId_status_idx" ON "game_session"("userId", "status");

-- CreateIndex
CREATE INDEX "game_session_shiftId_idx" ON "game_session"("shiftId");

-- CreateIndex
CREATE INDEX "game_session_expiresAt_idx" ON "game_session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "game_event_sessionId_seq_key" ON "game_event"("sessionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "run_sessionId_key" ON "run"("sessionId");

-- CreateIndex
CREATE INDEX "run_userId_finishedAt_idx" ON "run"("userId", "finishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "run_decision_runId_idx_key" ON "run_decision"("runId", "idx");

-- CreateIndex
CREATE INDEX "point_ledger_userId_createdAt_idx" ON "point_ledger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "point_ledger_runId_idx" ON "point_ledger"("runId");

-- CreateIndex
CREATE INDEX "point_ledger_expiresAt_idx" ON "point_ledger"("expiresAt");

-- CreateIndex
CREATE INDEX "user_achievement_code_idx" ON "user_achievement"("code");

-- CreateIndex
CREATE INDEX "season_score_userId_idx" ON "season_score"("userId");

-- CreateIndex
CREATE INDEX "notification_userId_createdAt_idx" ON "notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "promotion_recommendation_userId_status_idx" ON "promotion_recommendation"("userId", "status");

-- CreateIndex
CREATE INDEX "promotion_recommendation_decidedById_idx" ON "promotion_recommendation"("decidedById");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "audit_log_actorType_actorId_idx" ON "audit_log"("actorType", "actorId");

-- AddForeignKey
ALTER TABLE "brigade" ADD CONSTRAINT "brigade_depotId_fkey" FOREIGN KEY ("depotId") REFERENCES "depot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "brigade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "auth_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscription" ADD CONSTRAINT "webhook_subscription_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "api_client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_version" ADD CONSTRAINT "scenario_version_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "scenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenario_version" ADD CONSTRAINT "scenario_version_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignment" ADD CONSTRAINT "shift_assignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_session" ADD CONSTRAINT "game_session_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shift_assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_event" ADD CONSTRAINT "game_event_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run" ADD CONSTRAINT "run_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "game_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_decision" ADD CONSTRAINT "run_decision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_score" ADD CONSTRAINT "competency_score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "point_ledger" ADD CONSTRAINT "point_ledger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_achievement" ADD CONSTRAINT "user_achievement_code_fkey" FOREIGN KEY ("code") REFERENCES "achievement"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_score" ADD CONSTRAINT "season_score_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "season_score" ADD CONSTRAINT "season_score_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_recommendation" ADD CONSTRAINT "promotion_recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_recommendation" ADD CONSTRAINT "promotion_recommendation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
