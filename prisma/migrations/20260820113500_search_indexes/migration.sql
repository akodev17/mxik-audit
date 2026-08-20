-- Retrieval indexes Prisma's schema language cannot express.
-- Postgres ships no Uzbek text-search config, so full-text uses 'simple':
-- lowercase + tokenize, no stemming or stopwords. Stemming Uzbek agglutination
-- is what the trigram and vector stages are for.

ALTER TABLE "mxik_code"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "searchText")) STORED;

CREATE INDEX "mxik_code_search_vector_idx" ON "mxik_code" USING gin ("searchVector");

-- Trigram similarity over the same concatenated text, for fuzzy lexical recall.
CREATE INDEX "mxik_code_search_trgm_idx" ON "mxik_code" USING gin ("searchText" gin_trgm_ops);

-- Exact-equality lookup of a folded name against every indexed key variant.
CREATE INDEX "mxik_code_match_keys_idx" ON "mxik_code" USING gin ("matchKeys");

-- Base-code preference is a hot filter: 68.4% of subpositions have one.
CREATE INDEX "mxik_code_subposition_base_idx" ON "mxik_code" ("subPositionCode", "isBase");
