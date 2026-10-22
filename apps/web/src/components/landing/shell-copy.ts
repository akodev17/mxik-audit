// Header, footer and skip-link copy of the public shell. The landing itself is Uzbek; the help
// centre also has Russian articles, so the frame around them follows the article's language.
export type SiteLang = 'uz' | 'ru';

const uz = {
  skip: 'Asosiy qismga oʻtish',
  nav: 'Asosiy',
  menu: 'Menyu',
  demo: 'Demo',
  how: 'Qanday ishlaydi',
  pricing: 'Narxlar',
  faq: 'Savollar',
  help: 'Yordam',
  signIn: 'Kirish',
  signUp: 'Bepul boshlash',
  signUpShort: 'Boshlash',
  backToApp: 'Ilovaga qaytish',
  backToAppShort: 'Ilovaga',
  footerNav: 'Huquqiy va aloqa',
  privacy: 'Maxfiylik siyosati',
  offer: 'Ommaviy oferta',
  writeTelegram: 'Telegram orqali yozish',
  writeForm: 'Forma orqali yozish',
  legalNote: 'Yuridik havolalar lex.uz va Soliq qoʻmitasining rasmiy kanaliga olib boradi. Soliq oqibatlari boʻyicha qarorni oʻz maslahatchingiz bilan tasdiqlang.',
};

export const SHELL_COPY: Record<SiteLang, typeof uz> = {
  uz,
  ru: {
    skip: 'Перейти к основному содержимому',
    nav: 'Основное',
    menu: 'Меню',
    demo: 'Демо',
    how: 'Как это работает',
    pricing: 'Цены',
    faq: 'Вопросы',
    help: 'Помощь',
    signIn: 'Войти',
    signUp: 'Начать бесплатно',
    signUpShort: 'Начать',
    backToApp: 'Вернуться в приложение',
    backToAppShort: 'В приложение',
    footerNav: 'Документы и связь',
    privacy: 'Политика конфиденциальности',
    offer: 'Публичная оферта',
    writeTelegram: 'Написать в Telegram',
    writeForm: 'Написать через форму',
    legalNote: 'Юридические ссылки ведут на lex.uz и официальный канал Налогового комитета. Решение о налоговых последствиях согласуйте со своим консультантом.',
  },
};
