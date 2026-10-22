-- Indexes for the command palette's search (src/lib/search.ts). Additive only.
-- Like the other retrieval indexes, these are not expressible in schema.prisma.

-- Code prefix ("02202..."). The primary key's btree follows the database collation
-- (en_US), which cannot serve LIKE 'prefix%', so a rare prefix walked the whole
-- key in order. "code" is char(17), hence bpchar_pattern_ops.
CREATE INDEX IF NOT EXISTS "mxik_code_code_prefix_idx" ON "mxik_code" ("code" bpchar_pattern_ops);

-- Product name: ILIKE '%term%' over catalogue rows. pg_trgm is created by the first migration.
CREATE INDEX IF NOT EXISTS "catalog_item_rawName_trgm_idx" ON "catalog_item" USING gin ("rawName" gin_trgm_ops);
