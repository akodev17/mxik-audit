// The help-center articles: one MDX file per language under src/content/yordam.
export type HelpLang = 'uz' | 'ru';

export type HelpArticle = { slug: string; title: Record<HelpLang, string>; description: Record<HelpLang, string> };

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    slug: 'mxik-kodi-tuzilishi',
    title: { uz: 'MXIK kodi tuzilishi', ru: 'Структура кода ИКПУ' },
    description: { uz: '17 raqamli MXIK kodi qanday tuzilgan: guruh, sinf, pozitsiya, subpozitsiya, brend.', ru: 'Как устроен 17-значный код ИКПУ: группа, класс, позиция, субпозиция, бренд.' },
  },
  {
    slug: 'hisobotni-oqish',
    title: { uz: 'Hisobotni oʻqish', ru: 'Как читать отчёт' },
    description: { uz: 'Hisobot ustunlari, moslik belgilari, qarorlar va eksport.', ru: 'Столбцы отчёта, метки совпадения, решения и экспорт.' },
  },
  {
    slug: 'holatlar',
    title: { uz: 'Muammo turlari', ru: 'Типы проблем' },
    description: { uz: 'Hisobotdagi muammo turlarining maʼnosi va nima qilish kerakligi.', ru: 'Что означают типы проблем в отчёте и что делать.' },
  },
  {
    slug: 'firma-lugati',
    title: { uz: 'Firma lugʻati', ru: 'Словарь фирмы' },
    description: { uz: 'Tasdiqlangan qarorlar xotirasi: bir xil tovar uchun avval tasdiqlangan kod.', ru: 'Память о подтверждённых решениях: ранее подтверждённый код для того же товара.' },
  },
  {
    slug: 'tariflar-va-limitlar',
    title: { uz: 'Tariflar va limitlar', ru: 'Тарифы и лимиты' },
    description: { uz: 'Sinov va firma obunasi chegaralari, chegaraga yetganda nima boʻladi, toʻlov.', ru: 'Лимиты пробного периода и подписки фирмы, что происходит у лимита, оплата.' },
  },
  {
    slug: 'xavfsizlik-va-malumotlar',
    title: { uz: 'Xavfsizlik va maʼlumotlar', ru: 'Безопасность и данные' },
    description: { uz: 'Ikki bosqichli himoya, seanslar, eksport, fayllarni saqlash muddati va hisobni yopish.', ru: 'Двухэтапная защита, сеансы, экспорт, срок хранения файлов и закрытие аккаунта.' },
  },
  {
    slug: 'api-va-integratsiyalar',
    title: { uz: 'API va integratsiyalar', ru: 'API и интеграции' },
    description: { uz: 'API kalitlari va chegaralar, Telegram xabarnomalari, Google Sheets qoʻshimchasi.', ru: 'Ключи API и лимиты, уведомления в Telegram, дополнение для Google Таблиц.' },
  },
  {
    slug: 'tez-tez-soraladigan-savollar',
    title: { uz: 'Tez-tez beriladigan savollar', ru: 'Частые вопросы' },
    description: { uz: 'Fayllar, rollar, mijoz havolasi, API va EHF haqida javoblar.', ru: 'Ответы о файлах, ролях, ссылке для клиента, API и ЭСФ.' },
  },
];

type Copy = { title: string; description: string; back: string; language: string; home: string; onPage: string };

/** Each language named in itself, for the help language switch. */
export const HELP_LANG_NAMES: Record<HelpLang, string> = { uz: 'Oʻzbekcha', ru: 'Русский' };

export const HELP_COPY: Record<HelpLang, Copy> = {
  uz: {
    title: 'Yordam markazi',
    description: 'Tasnivo qanday ishlashi: kod tuzilishi, hisobot, muammo turlari, firma lugʻati, tariflar, xavfsizlik, API va savollar.',
    back: 'Yordam markazi', language: 'Maqola tili', home: 'Boshqa maqolalar', onPage: 'Shu maqolada',
  },
  ru: {
    title: 'Центр помощи',
    description: 'Как работает Tasnivo: структура кода, отчёт, типы проблем, словарь фирмы, тарифы, безопасность, API и вопросы.',
    back: 'Центр помощи', language: 'Язык статьи', home: 'Другие статьи', onPage: 'В этой статье',
  },
};

/** Query flag on the language switch: the reader chose Uzbek, so a Russian app locale does not redirect. */
export const HELP_LANG_PARAM = 'til';

export const helpPath = (lang: HelpLang, slug?: string): string => `/yordam${lang === 'ru' ? '/ru' : ''}${slug ? `/${slug}` : ''}`;

export function findArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}

/** Anchor id of a heading: letters and digits of any script, joined by dashes. */
export function headingId(text: string): string {
  return text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export type HelpHeading = { id: string; text: string };

/** The "## " headings of an article's MDX source, for its table of contents. */
export function helpHeadings(source: string): HelpHeading[] {
  return source.split(/\r?\n/)
    .map((line) => /^##\s+(.+?)\s*$/.exec(line)?.[1])
    .filter((text): text is string => Boolean(text))
    .map((raw) => raw.replace(/[*_`]/g, ''))
    .map((text) => ({ id: headingId(text), text }));
}
