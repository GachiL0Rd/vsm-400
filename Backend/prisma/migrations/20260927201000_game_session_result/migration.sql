-- AlterTable
ALTER TABLE "game_session" ADD COLUMN "result" JSONB;

-- Итог рейса из последней записи аудита. Дальше его пишет сессия, не audit_log.
UPDATE "game_session" AS session
SET "result" = jsonb_build_object(
  'runId', latest.meta->>'runId',
  'suspicious', COALESCE((latest.meta->>'suspicious')::boolean, false),
  'summary', latest.meta->'summary'
)
FROM (
  SELECT DISTINCT ON ("target") "target", "meta"
  FROM "audit_log"
  WHERE "action" = 'session.completed'
    AND "target" IS NOT NULL
    AND "meta" IS NOT NULL
    AND jsonb_typeof("meta") = 'object'
    AND "meta" ? 'runId'
  ORDER BY "target", "id" DESC
) AS latest
WHERE session."id"::text = latest."target"
  AND session."result" IS NULL;
