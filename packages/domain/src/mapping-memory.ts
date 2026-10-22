// Remembered column mappings, by header NAME rather than column position: the
// client's last committed catalogue first, then the org's. A remembered field is
// used only when this file has a column of that name, so the label "remembered"
// is never shown for a mapping that was in fact guessed.
import { COLUMN_FIELDS, ColumnMapSchema, type ColumnField, type ColumnMap } from './column-map.js';
import { db } from '@tasnivo/db';
import { guessMapping } from './mapping-guess.js';

/** Field → the header name it was mapped to. */
export type NamedMapping = Partial<Record<ColumnField, string>>;
export type MemorySource = 'client' | 'org';
export type FieldSource = 'remembered' | 'guess' | 'none';

export type MappingSuggestion = {
  mapping: ColumnMap;
  /** Where the remembered part came from; null when nothing remembered was used. */
  remembered: MemorySource | null;
  fields: Record<ColumnField, FieldSource>;
};

/** Case, apostrophe variants and spacing do not make two headers different. */
export const headerKey = (s: string): string => s.toLowerCase().replace(/[ʻʼ'`’‘]/g, '').replace(/\s+/g, ' ').trim();

/** The mapping as header names, for the file it was made on. */
export function toNamed(headers: readonly string[], mapping: ColumnMap): NamedMapping {
  const named: NamedMapping = {};
  for (const field of COLUMN_FIELDS) {
    const header = mapping[field] >= 0 ? headers[mapping[field]] : undefined;
    if (header !== undefined && header.trim() !== '') named[field] = header;
  }
  return named;
}

/** Resolves remembered header names against this file's headers (first match wins, each column once). */
export function resolveNamed(named: NamedMapping, headers: readonly string[]): Partial<Record<ColumnField, number>> {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const out: Partial<Record<ColumnField, number>> = {};
  for (const field of COLUMN_FIELDS) {
    const name = named[field];
    if (!name) continue;
    const index = keys.findIndex((k, i) => k === headerKey(name) && !used.has(i));
    if (index >= 0) { out[field] = index; used.add(index); }
  }
  return out;
}

/**
 * Combines a remembered mapping with the header guess. The remembered one is
 * used only when its name column exists in this file; its other fields fill in
 * where they resolve, and the guess covers the rest without reusing a column.
 */
export function mergeSuggestion(headers: readonly string[], memory: { named: NamedMapping; source: MemorySource }[]): MappingSuggestion {
  const guess = guessMapping(headers);
  for (const { named, source } of memory) {
    const resolved = resolveNamed(named, headers);
    if (resolved.name === undefined) continue;
    const mapping = { ...guess };
    const fields = {} as Record<ColumnField, FieldSource>;
    const taken = new Set(Object.values(resolved));
    for (const field of COLUMN_FIELDS) {
      const remembered = resolved[field];
      if (remembered !== undefined) { mapping[field] = remembered; fields[field] = 'remembered'; continue; }
      // Fields the remembered file did not have here come from the guess, never from a column already used.
      const guessed = guess[field];
      mapping[field] = guessed >= 0 && !taken.has(guessed) ? guessed : -1;
      if (mapping[field] >= 0) taken.add(mapping[field]);
      fields[field] = mapping[field] >= 0 ? 'guess' : 'none';
    }
    return { mapping, remembered: source, fields };
  }
  const fields = Object.fromEntries(COLUMN_FIELDS.map((f) => [f, guess[f] >= 0 ? 'guess' : 'none'])) as Record<ColumnField, FieldSource>;
  return { mapping: guess, remembered: null, fields };
}

async function lastCommitted(where: { orgId: string; clientId?: string }, excludeId?: string): Promise<NamedMapping | null> {
  const catalog = await db.catalog.findFirst({
    where: { ...where, status: { not: 'uploaded' }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: { headers: true, columnMap: true },
  });
  const map = ColumnMapSchema.safeParse(catalog?.columnMap);
  return catalog && map.success ? toNamed(catalog.headers, map.data) : null;
}

/** The suggestion for an upload: this client's last mapping, then the org's, then the header guess. */
export async function suggestMapping(orgId: string, clientId: string | null, headers: readonly string[], excludeCatalogId?: string): Promise<MappingSuggestion> {
  const [forClient, forOrg] = await Promise.all([
    clientId ? lastCommitted({ orgId, clientId }, excludeCatalogId) : Promise.resolve(null),
    lastCommitted({ orgId }, excludeCatalogId),
  ]);
  const memory: { named: NamedMapping; source: MemorySource }[] = [
    ...(forClient ? [{ named: forClient, source: 'client' as const }] : []),
    ...(forOrg ? [{ named: forOrg, source: 'org' as const }] : []),
  ];
  return mergeSuggestion(headers, memory);
}
