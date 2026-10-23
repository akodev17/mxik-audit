// Two-letter marks for avatars (clients, the signed-in person). Pure; the name is always printed beside them.

/** Words that only say what kind of company it is: "MChJ Baraka" is marked BA, not MB. */
const LEGAL = new Set(['mchj', 'xk', 'xt', 'aj', 'oaj', 'yatt', 'ooo', 'оао', 'ооо', 'зао', 'ао', 'ип', 'llc', 'ltd']);

/** First letters of the first two words that are not a legal form; "·" when nothing is left. */
export function nameInitials(name: string): string {
  // Apostrophes belong to the word (Oʻzbek, Mas'uliyati); other marks separate words.
  const words = name.replace(/[ʻʼ'`‘’]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  const meaningful = words.filter((w) => !LEGAL.has(w.toLocaleLowerCase()));
  const picked = (meaningful.length > 0 ? meaningful : words).slice(0, 2);
  return picked.map((w) => w[0]?.toLocaleUpperCase() ?? '').join('') || '·';
}

/** "akromjon.rahimjonov@x.uz" → "AR", "buxgalter@demo.uz" → "B". */
export function emailInitials(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._\-+]+/).filter((p) => /\p{L}/u.test(p[0] ?? ''));
  const picked = parts.slice(0, 2).map((p) => p[0]?.toLocaleUpperCase() ?? '').join('');
  return picked || (local[0]?.toLocaleUpperCase() ?? '·');
}
