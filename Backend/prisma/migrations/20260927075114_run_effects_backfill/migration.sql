-- Уже записанные рейсы не должны попасть в минутную сверку эффектов.
UPDATE "run" SET "effectsAt" = "finishedAt" WHERE "effectsAt" IS NULL;
