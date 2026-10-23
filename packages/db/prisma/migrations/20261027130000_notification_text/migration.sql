-- Notifications in every interface language (B13, agent2-bug-fixes). Additive only: a nullable column;
-- older rows keep title/body, which readers fall back to.
ALTER TABLE "notification" ADD COLUMN IF NOT EXISTS "text" JSONB;
