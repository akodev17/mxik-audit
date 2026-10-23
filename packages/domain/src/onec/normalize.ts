// Counterparty names as statements, invoices and 1C write them, folded to one matching key:
// «ООО "Ромашка"», 'OOO «ROMASHKA»', 'Romashka MChJ' and '  ромашка ' all become 'ромашка' /
// 'romashka'. Script is not transliterated (Cyrillic and Latin spellings stay different keys; an
// alias joins them once a reviewer confirms). Pure.

/**
 * Legal-form words, lower-cased, after punctuation is gone. Russian, Uzbek Latin and Cyrillic, and
 * the English forms banks print. Longer phrases first so they win over their parts.
 */
const LEGAL_PHRASES = [
  'общество с ограниченной ответственностью', 'masuliyati cheklangan jamiyat', 'масъулияти чекланган жамият',
  'акционерное общество', 'aksiyadorlik jamiyati', 'акциядорлик жамияти', 'частное предприятие', 'xususiy korxona',
  'хусусий корхона', 'индивидуальный предприниматель', 'yakka tartibdagi tadbirkor', 'якка тартибдаги тадбиркор',
  'fermer xojaligi', 'фермер хужалиги', 'фермерское хозяйство', 'limited liability company',
];
const LEGAL_WORDS = new Set([
  'ооо', 'ooo', 'оао', 'зао', 'пао', 'ао', 'чп', 'ип', 'ип.', 'мчж', 'mchj', 'xk', 'хк', 'aj', 'аж', 'qk', 'кк', 'ok', 'ок', 'yatt',
  'ятт', 'xf', 'фх', 'дп', 'гуп', 'llc', 'jsc', 'ltd', 'inc',
]);

// Quotes and apostrophes of every kind (Uzbek o‘ / gʻ included): dropped, not spaced, so "o'zbek" stays one word.
const APOSTROPHES = /['`´ʻʼ‘’‛′]/g;

export function normalizeName(name: string): string {
  let text = name.normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(APOSTROPHES, '');
  // Everything that is not a letter or a digit separates words: «», "", „“, dots, commas, dashes.
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const phrase of LEGAL_PHRASES) text = ` ${text} `.split(` ${phrase} `).join(' ').trim();
  const words = text.split(' ').filter((w) => w && !LEGAL_WORDS.has(w));
  // A name that is only a legal form ("ООО") keeps its words rather than becoming empty.
  return (words.length > 0 ? words : text.split(' ').filter(Boolean)).join(' ');
}

/** Digits only (ИНН, accounts, МФО as printed with spaces or dashes); null when nothing is left. */
export function digitsOnly(value: string | null | undefined): string | null {
  const d = (value ?? '').replace(/\D/g, '');
  return d.length > 0 ? d : null;
}
