// The text an embedding model sees, for both sides of the vector stage. One
// function, so the stored vectors (embed:catalog, embed-missing) and the query
// vector (pipeline) can never drift into different distributions again. Pure.
//
// Two shapes:
//   folded   the match key: Latin, lower case, no apostrophes. The hashing
//            stand-in needs it (it hashes surface trigrams), and e5 vectors
//            stored before 2026-10-22 were made from it.
//   natural  the text as a person reads it: original script, case and
//            apostrophes, trade abbreviations expanded. What e5 was trained on;
//            on folded text its similarities bunch at 0.85-0.91 and stop
//            discriminating (phase 0 probes, plan §5).
import { matchKeyOf, normalizeApostrophes, normalizeName, squeezeWhitespace } from '../normalize/index.js';

/** A catalogue row is a query; a classifier name is a passage (e5's "query: " / "passage: "). */
export type EmbedRole = 'query' | 'passage';

export type TextShape = 'folded' | 'natural';

export function embeddingText(text: string, role: EmbedRole, shape: TextShape): string {
  if (shape === 'folded') {
    if (role === 'passage') return matchKeyOf(text);
    // Exactly the pipeline's lexical query before 2026-10-22, so folded vectors stay comparable.
    const n = normalizeName(text);
    return n.queryKey || n.matchKey || n.core;
  }
  if (role === 'passage') return squeezeWhitespace(normalizeApostrophes(text));
  // Noise (pack sizes, counts) stripped and abbreviations expanded, script and case kept.
  const n = normalizeName(text);
  return n.core || n.display;
}
