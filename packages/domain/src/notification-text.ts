// Notification wording, shared by the app and Telegram. Pure. Notifications store
// rendered text: title/body in the org's language (src/lib/org-locale.ts) for Telegram and
// older readers, and every language in `text` so the app shows each reader theirs (B13).
import { fmtDate } from '@tasnivo/i18n/format';
import { LOCALES, type Locale } from '@tasnivo/i18n/i18n';

export type NoticeText = { title: string; body: string };

/** A notice's title and body in every interface language (Notification.text). */
export type NoticeTexts = Record<Locale, NoticeText>;

export function inEveryLocale(make: (locale: Locale) => NoticeText): NoticeTexts {
  return Object.fromEntries(LOCALES.map((locale) => [locale, make(locale)])) as NoticeTexts;
}

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

export type ReviewTextInput = { clientName: string; filename: string; dueOn?: Date | null; note?: string | null; by?: string | null };

const REVIEW_WORDS = {
  uz: {
    assigned: (c: string) => `Sizga tekshiruv topshirildi: ${c}`,
    completed: (c: string) => `Tekshiruv yakunlandi: ${c}`,
    ready: (c: string) => `Tekshiruv tugadi: ${c}`,
    file: 'Fayl', due: 'Muddat', note: 'Izoh', by: 'Topshirdi', doneBy: 'Yakunladi',
    readyBody: 'Katalog tekshirildi, natijalarni koʻrib chiqishingiz mumkin.',
    open: (n: number) => `Qaror kutayotgan topilmalar: ${n}.`,
  },
  ru: {
    assigned: (c: string) => `Вам передана проверка: ${c}`,
    completed: (c: string) => `Проверка завершена: ${c}`,
    ready: (c: string) => `Проверка готова: ${c}`,
    file: 'Файл', due: 'Срок', note: 'Комментарий', by: 'Передал(а)', doneBy: 'Завершил(а)',
    readyBody: 'Каталог проверен, можно просматривать результаты.',
    open: (n: number) => `Требуют решения: ${n}.`,
  },
} as const;

function reviewBody(kind: 'assigned' | 'completed', i: ReviewTextInput, locale: Locale): string {
  const w = REVIEW_WORDS[locale];
  const parts = [`${w.file}: ${i.filename}.`];
  if (kind === 'assigned' && i.dueOn) parts.push(`${w.due}: ${fmtDate(locale, i.dueOn)}.`);
  if (i.by) parts.push(`${kind === 'assigned' ? w.by : w.doneBy}: ${i.by}.`);
  if (i.note) parts.push(`${w.note}: ${i.note}`);
  return parts.join(' ');
}

export const reviewAssignedText = (i: ReviewTextInput, locale: Locale = 'uz'): { title: string; body: string } => ({
  title: REVIEW_WORDS[locale].assigned(i.clientName), body: reviewBody('assigned', i, locale),
});

export const reviewCompletedText = (i: ReviewTextInput, locale: Locale = 'uz'): { title: string; body: string } => ({
  title: REVIEW_WORDS[locale].completed(i.clientName), body: reviewBody('completed', i, locale),
});

/** A catalogue's audit finished; the count comes from the stored findings, never from a guess. */
export function auditReadyText(i: { clientName: string; filename: string; open: number }, locale: Locale = 'uz'): { title: string; body: string } {
  const w = REVIEW_WORDS[locale];
  return { title: w.ready(i.clientName), body: `${w.readyBody} ${w.open(i.open)} ${w.file}: ${i.filename}.` };
}
