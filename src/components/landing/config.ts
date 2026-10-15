// Landing page switches. NEXT_PUBLIC_* values are inlined at build time, so a
// change needs a rebuild. Every flag defaults to "off": an unset variable must
// never put an unconfirmed claim or a dead link on the page.

/**
 * Tax Code art. 223 part 5 as the citation on the "Jarima" card.
 * Keep false until a tax adviser has confirmed the wording against lex.uz.
 */
export const SHOW_LEGAL_223 = process.env.NEXT_PUBLIC_SHOW_LEGAL_223 === 'true';
