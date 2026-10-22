// The /dictionary URL read the way dictionary-ops.ts dictionaryPage() reads it, so the API gets
// only values it accepts and the links keep what the page shows.

export const DICT_FILTERS = ['all', 'confirmed', 'unverified', 'stale'] as const;
export type DictFilter = (typeof DICT_FILTERS)[number];

export function parseDictFilter(value: unknown): DictFilter {
  return typeof value === 'string' && (DICT_FILTERS as readonly string[]).includes(value) ? (value as DictFilter) : 'all';
}

export function readDictParams(p: { q?: string | undefined; page?: string | undefined; f?: string | undefined }): { q: string; page: number; filter: DictFilter } {
  const page = Math.max(0, Math.floor(Number(p.page) || 0));
  return { q: (p.q ?? '').trim().slice(0, 80), page: Number.isSafeInteger(page) ? page : 0, filter: parseDictFilter(p.f) };
}
