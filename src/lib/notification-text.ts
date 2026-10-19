// Notification wording, shared by the app and Telegram. Pure. Notifications store
// rendered text, so callers render it in the org's language (src/lib/org-locale.ts).
import { fmtDate } from './format.js';
import type { Locale } from './i18n.js';

export type UpdateCounts = {
  /** Distinct codes in the client's catalogue that the update archived. */
  archived: number;
  unitChanged: number;
  nameChanged: number;
  /** New problems recorded in the client's catalogue. */
  newFindings: number;
};

const WORDS = {
  uz: {
    archived: (n: number) => `${n} ta kod arxivlandi`,
    unit: (n: number) => `${n} ta kodning oʻlchov birligi oʻzgardi`,
    name: (n: number) => `${n} ta kod nomi oʻzgardi`,
    client: 'Mijoz',
    some: (n: number) => `Katalogda ${n} ta yangi muammo qayd etildi.`,
    none: 'Yangi muammo topilmadi.',
    updated: 'Tasniflagich yangilandi',
    file: 'Fayl',
  },
  ru: {
    archived: (n: number) => `архивировано кодов: ${n}`,
    unit: (n: number) => `изменилась единица измерения у кодов: ${n}`,
    name: (n: number) => `изменилось название у кодов: ${n}`,
    client: 'Клиент',
    some: (n: number) => `В каталоге зафиксировано новых проблем: ${n}.`,
    none: 'Новых проблем не найдено.',
    updated: 'Классификатор обновлён',
    file: 'Файл',
  },
} as const;

export function updateParts(c: UpdateCounts, locale: Locale = 'uz'): string[] {
  const w = WORDS[locale];
  return [
    c.archived > 0 ? w.archived(c.archived) : null,
    c.unitChanged > 0 ? w.unit(c.unitChanged) : null,
    c.nameChanged > 0 ? w.name(c.nameChanged) : null,
  ].filter((p): p is string => p !== null);
}

/** "Mijoz X: 3 ta kod arxivlandi, 1 ta kodning oʻlchov birligi oʻzgardi" */
export function updateTitle(clientName: string, c: UpdateCounts, locale: Locale = 'uz'): string {
  return `${WORDS[locale].client} ${clientName}: ${updateParts(c, locale).join(', ')}`;
}

export function updateBody(c: UpdateCounts, filename: string, date: Date, locale: Locale = 'uz'): string {
  const w = WORDS[locale];
  const findings = c.newFindings > 0 ? w.some(c.newFindings) : w.none;
  return `${w.updated} (${fmtDate(locale, date)}). ${findings} ${w.file}: ${filename}.`;
}
