// "Pick another code": classifier hits with names and paths in the viewer's language. The search
// itself is passed in, so a long-lived process (the API) can keep one candidate store while the
// web's server action builds one per call (searchClassifier).
import type { Locale } from '@tasnivo/i18n/i18n';
import type { searchClassifierIn } from './audit-runner.js';
import { codeDetails } from './code-details.js';

export type ClassifierHit = {
  code: string;
  name: string;
  path: string;
  isBase: boolean;
  unit: string | null;
};

type Candidate = Awaited<ReturnType<typeof searchClassifierIn>>[number];

export type ClassifierSearch = (query: string, limit: number) => Promise<Candidate[]>;

export const LOOKUP_LIMIT = 10;

/** The query as the box sends it, trimmed to 100 characters; null under 2 characters (nothing to search). */
export function lookupQuery(query: unknown): string | null {
  if (typeof query !== 'string') return null;
  const trimmed = query.trim().slice(0, 100);
  return trimmed.length < 2 ? null : trimmed;
}

/** Up to ten hits for the "pick another code" box; [] for a query under 2 characters. */
export async function lookupCodes(query: unknown, locale: Locale, search: ClassifierSearch): Promise<ClassifierHit[]> {
  const trimmed = lookupQuery(query);
  if (!trimmed) return [];
  const hits = await search(trimmed, LOOKUP_LIMIT);
  const details = await codeDetails(hits.map((c) => c.code), locale);
  return hits.map((c) => {
    const d = details.get(c.code);
    return {
      code: c.code,
      name: d?.name ?? c.nameUz,
      path: d?.fullPath ?? [c.groupName, c.className, c.positionName, c.subPositionName].filter((s): s is string => Boolean(s)).join(' → '),
      isBase: c.isBase,
      unit: c.unitBinding === 'strict' && c.unitCanonical.length > 0 ? c.unitCanonical.join(' / ') : null,
    };
  });
}
