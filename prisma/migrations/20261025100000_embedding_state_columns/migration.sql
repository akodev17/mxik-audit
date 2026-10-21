-- Which vector columns hold the recorded provider's vectors (plan §5, 2026-10-22).
-- Additive. 'uz' = "embeddingUz" (from nameUz), 'ru' = "embeddingRu" (from nameRu).
-- The default describes every database embedded before this migration: only
-- "embeddingUz" was filled, "embeddingRu" was cleared. `npm run embed:catalog`
-- now fills both and records {uz,ru}; the pipeline then searches the column of
-- the row's script.
ALTER TABLE "embedding_state" ADD COLUMN IF NOT EXISTS "columns" TEXT[] NOT NULL DEFAULT ARRAY['uz']::TEXT[];
