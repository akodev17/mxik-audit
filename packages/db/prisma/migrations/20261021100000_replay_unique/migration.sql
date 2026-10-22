-- One-time values (Telegram login hashes) are claimed atomically: a second insert of the same key is a conflict.
-- Earlier duplicate claims (from before this index) keep only their oldest row.
DELETE FROM "auth_attempt" a
USING "auth_attempt" b
WHERE a."kind" = 'tg_replay' AND b."kind" = 'tg_replay' AND a."key" = b."key"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");
CREATE UNIQUE INDEX "auth_attempt_once_key" ON "auth_attempt"("kind", "key") WHERE "kind" = 'tg_replay';
