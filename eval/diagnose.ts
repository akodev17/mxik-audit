// Why a real case missed the top five, in tokens. Pure: the eval prints the
// query's words next to the correct code's words, so a reader can tell a
// vocabulary miss ("арматура" vs "прокат арматурный") from an inflection miss
// ("bloki" vs "blok"), which is the evidence the plan asks for before anyone
// adds a stemmer (see docs/scoring.md).

/** Letters two words must share at the start to count as one word inflected differently. */
export const INFLECTION_PREFIX = 5;

export type MissDiagnostic = {
  /** Query words found as-is among the correct code's words. */
  shared: string[];
  /** Query words that differ from a code word only after a common stem: "query~code". */
  inflection: string[];
  /** Query words with no counterpart at all in the correct code's names. */
  queryOnly: string[];
};

const isWord = (t: string): boolean => t.length >= 3 && !/^\d+$/.test(t);

/** Compares the query's words with the correct code's words. Order follows the query. */
export function diagnoseMiss(queryTokens: readonly string[], codeTokens: readonly string[]): MissDiagnostic {
  const code = [...new Set(codeTokens.filter(isWord))];
  const codeSet = new Set(code);
  const shared: string[] = [];
  const inflection: string[] = [];
  const queryOnly: string[] = [];
  for (const q of new Set(queryTokens.filter(isWord))) {
    if (codeSet.has(q)) {
      shared.push(q);
      continue;
    }
    const stem = q.length >= INFLECTION_PREFIX ? q.slice(0, INFLECTION_PREFIX) : null;
    const near = stem === null ? undefined : code.find((c) => c.startsWith(stem));
    if (near) inflection.push(`${q}~${near}`);
    else queryOnly.push(q);
  }
  return { shared, inflection, queryOnly };
}
