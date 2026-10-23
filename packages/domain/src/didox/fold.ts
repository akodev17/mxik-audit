// Folds the formatting differences between two spellings of one product inside an invoice, so
// "Цемент М400 50кг" and "ЦЕМЕНТ  М-400, 50 кг" become one candidate group before the product
// matcher runs: case, ё/е, Latin/Cyrillic look-alikes, punctuation and hyphens, double spaces,
// "50 кг" vs "50кг", and a unit word appended to the name ("... шт", "(дона)"). The key is only a
// grouping key inside one document; it is never shown or stored as a product name.

/** Latin letters that look like Cyrillic ones, folded to the Cyrillic letter (M400 and М400 alike). */
const LOOKALIKE: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};

/** Unit spellings → one form. Matched as whole tokens after lower-casing, before the look-alike fold. */
const UNIT_WORDS: Record<string, string> = {
  кг: 'кг', kg: 'кг', килограмм: 'кг', kilogramm: 'кг', kilogram: 'кг',
  г: 'г', гр: 'г', g: 'г', gr: 'г', грамм: 'г', gramm: 'г',
  л: 'л', l: 'л', литр: 'л', litr: 'л',
  мл: 'мл', ml: 'мл',
  м: 'м', метр: 'м', metr: 'м',
  мм: 'мм', mm: 'мм', см: 'см', sm: 'см', cm: 'см',
  м2: 'м2', м3: 'м3', m2: 'м2', m3: 'м3',
  т: 'т', тн: 'т', тонна: 'т', tonna: 'т',
  шт: 'шт', штук: 'шт', штука: 'шт', pcs: 'шт', dona: 'шт', дона: 'шт',
  уп: 'уп', упак: 'уп', упаковка: 'уп', упаковки: 'уп', qadoq: 'уп', pack: 'уп',
};

/** Units that, standing alone at the end of a name, only repeat the line's unit ("Болт М8 шт"). */
const TRAILING_COUNT_UNITS = new Set(['шт', 'уп']);

function unitOf(token: string): string | null {
  return UNIT_WORDS[token] ?? null;
}

function foldLetters(token: string): string {
  return [...token].map((ch) => LOOKALIKE[ch] ?? ch).join('');
}

/**
 * The grouping key of a product name. Two names with the same key are the same product as far as
 * the invoice can tell; different numbers or units ("50кг" vs "25кг") stay different.
 */
export function foldName(name: string): string {
  let text = name.normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
  // Keep decimal marks inside numbers ("0,5 л" = "0.5л"), then drop every other punctuation mark.
  text = text.replace(/(\d)[,.](\d)/g, '$1\u0000$2');
  text = text.replace(/[^\p{L}\p{N}\u0000]+/gu, ' ').replace(/\u0000/g, '.');
  const raw = text.split(' ').filter(Boolean);

  // Split glued number+unit ("50кг") into two tokens so both spellings take the same path below.
  const tokens: string[] = [];
  for (const token of raw) {
    const glued = /^(\d+(?:\.\d+)?)(\p{L}+\d?)$/u.exec(token);
    if (glued?.[1] && glued[2] && unitOf(glued[2])) tokens.push(glued[1], glued[2]);
    else tokens.push(token);
  }

  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const next = tokens[i + 1];
    const unit = unitOf(token);
    // A number followed by a unit is one measurement token: "50 кг" → "50кг".
    if (/^\d+(?:\.\d+)?$/.test(token) && next && unitOf(next)) {
      out.push(`${token}${unitOf(next)}`);
      i++;
      continue;
    }
    // A one- or two-letter series prefix joined to its number: "м 400" (from "м-400") → "м400".
    // "м" is also a unit, but a unit after a number was taken by the rule above; here it leads.
    if (/^\p{L}{1,2}$/u.test(token) && next && /^\d+$/.test(next) && !unitOf(tokens[i + 2] ?? '')) {
      out.push(`${foldLetters(token)}${next}`);
      i++;
      continue;
    }
    out.push(unit ?? foldLetters(token));
  }
  while (out.length > 1 && TRAILING_COUNT_UNITS.has(out[out.length - 1] ?? '')) out.pop();
  return out.join(' ');
}

/** Groups line indexes by folded name; only groups with more than one line are returned. */
export function duplicateNameGroups(names: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  names.forEach((name, i) => {
    const key = foldName(name);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  for (const [key, members] of groups) if (members.length < 2) groups.delete(key);
  return groups;
}
