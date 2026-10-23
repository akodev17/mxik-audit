// Fixed values of domain and core modules that the web app needs (the originals sit next to server
// code); tests/web-parity/pure.test.ts compares them.

/** search-query.ts MIN_TEXT: the palette searches from this many characters. */
export const MIN_SEARCH_TEXT = 2;

/** demo-access-fields.ts USE_CASES: what the demo form asks the visitor to pick. */
export const DEMO_USE_CASES = ['own_company', 'clients', 'evaluation', 'other'] as const;

/** core match/confidence-labels.ts LabelKey: how a suggestion is labelled. */
export const LABEL_KEYS = ['sure', 'likely', 'check', 'barcode', 'dictionary'] as const;
export type LabelKey = (typeof LABEL_KEYS)[number];
