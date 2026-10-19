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
    description: { uz: 'Hisobot ustunlari, ishonch darajalari, qarorlar va eksport.', ru: 'Столбцы отчёта, уровни уверенности, решения и экспорт.' },
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
    slug: 'tez-tez-soraladigan-savollar',
    title: { uz: 'Tez-tez beriladigan savollar', ru: 'Частые вопросы' },
    description: { uz: 'Fayllar, rollar, mijoz havolasi, API va EHF haqida javoblar.', ru: 'Ответы о файлах, ролях, ссылке для клиента, API и ЭСФ.' },
  },
];

export const HELP_COPY: Record<HelpLang, { title: string; description: string; back: string; other: string; home: string }> = {
  uz: { title: 'Yordam markazi', description: 'MXIK Audit qanday ishlashi: kod tuzilishi, hisobot, muammo turlari, firma lugʻati va savollar.', back: 'Yordam markazi', other: 'Ruscha', home: 'Boshqa maqolalar' },
  ru: { title: 'Центр помощи', description: 'Как работает MXIK Audit: структура кода, отчёт, типы проблем, словарь фирмы и вопросы.', back: 'Центр помощи', other: 'Oʻzbekcha', home: 'Другие статьи' },
};

export const helpPath = (lang: HelpLang, slug?: string): string => `/yordam${lang === 'ru' ? '/ru' : ''}${slug ? `/${slug}` : ''}`;

export function findArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}
