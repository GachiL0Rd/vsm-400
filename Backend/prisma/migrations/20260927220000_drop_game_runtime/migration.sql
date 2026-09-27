-- DropTable
DROP TABLE "game_telemetry";

-- DropTable
DROP TABLE "game_event";

-- AlterTable
ALTER TABLE "game_session" DROP COLUMN "state",
DROP COLUMN "seq",
DROP COLUMN "nodeDeadlineAt";
