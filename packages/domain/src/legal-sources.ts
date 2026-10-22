// Sources the app may cite, each only for the sentence it supports. Same
// verification as the landing page (src/components/landing/data.ts, checked
// 15.10.2026); keep the two in step.
export type LegalSource = { label: string; href: string; supports: string };

/** EHF restricted when a trade company's sale has no purchase with the same MXIK. */
export const PURCHASE_CHECK_SOURCES: readonly LegalSource[] = [
  {
    label: 'VMQ № 595, 22.09.2021, 6-band «g»',
    href: 'https://lex.uz/docs/5650010',
    supports: 'yetkazib beruvchida tovar mavjudligini avtomatik aniqlash, tovar boʻlmasa — EHFni cheklash',
  },
  {
    label: 'Soliq qoʻmitasi rasmiy munosabati, 08.04.2026',
    href: 'https://t.me/soliqnews/18626',
    supports: 'savdo korxonalariga qoʻllanishi va MXIK boʻyicha solishtirish',
  },
];

/**
 * Tax Code art. 223 part 5 (1% of the sale value). Read from a consolidated
 * edition, not yet confirmed on lex.uz by a tax adviser: shown only behind
 * NEXT_PUBLIC_SHOW_LEGAL_223.
 */
export const FINE_223_SOURCE: LegalSource = {
  label: 'Soliq kodeksi, 223-modda, 5-qism',
  href: 'https://lex.uz/docs/4674902',
  supports: 'nomenklaturaga mos kelmaydigan identifikatsiya kodi uchun sotuv qiymatining 1% miqdorida jarima',
};
