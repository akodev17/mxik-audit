// Module flags (packages/contracts/src/feature-modules.ts): the "coming soon" badge, page and dashboard
// list, each module's name and description, and the owner's /admin/features page.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).

export const uz = {
  featuresX: {
    _area: 'features',
    soon: 'Tez kunda',
    page: {
      hint: 'Bu boʻlim tayyorlanmoqda va tez orada ochiladi.',
      back: 'Bosh sahifaga',
    },
    dashboard: {
      title: 'Tez kunda',
      hint: 'Tayyorlanayotgan boʻlimlar',
    },
    modules: {
      mxik_audit: { label: 'MXIK audit', description: 'Katalogni yuklash, MXIK kodlarini tekshirish, koʻrib chiqish navbati va lugʻat' },
      products: { label: 'Mahsulotlar katalogi', description: 'MXIK kodli mahsulotlar roʻyxati, import va eksport' },
      didox: { label: 'Didox hisob-fakturalar', description: 'Didox elektron hisob-fakturalari: sinxronlash, tekshirish va 1C ga eksport' },
      bank: { label: 'Bank koʻchirmalari', description: 'Bank koʻchirmalarini yuklash, qoidalar, solishtirish va 1C ga eksport' },
      onec: { label: '1C import va tarix', description: '1C ulanishi, import toʻplamlari, kontragentlar va eksport tarixi' },
    },
    admin: {
      title: 'Modullar',
      hint: 'Qaysi boʻlim foydalanuvchilarga ochiq, “tez kunda” deb koʻrsatiladi yoki butunlay yashiriladi. Oʻzgarish 30 soniya ichida hamma joyda kuchga kiradi.',
      module: 'Modul',
      state: 'Holat',
      enabled: 'Yoqilgan',
      comingSoon: 'Tez kunda',
      hidden: 'Yashirin',
      save: 'Saqlash',
      saved: 'Saqlandi',
      failed: 'Saqlab boʻlmadi. Qayta urinib koʻring.',
    },
  },
};

export const ru: typeof uz = {
  featuresX: {
    _area: 'features',
    soon: 'Скоро',
    page: {
      hint: 'Этот раздел готовится и скоро откроется.',
      back: 'На главную',
    },
    dashboard: {
      title: 'Скоро',
      hint: 'Разделы, которые готовятся',
    },
    modules: {
      mxik_audit: { label: 'Аудит ИКПУ', description: 'Загрузка каталога, проверка кодов ИКПУ, очередь проверки и словарь' },
      products: { label: 'Каталог товаров', description: 'Список товаров с кодами ИКПУ, импорт и экспорт' },
      didox: { label: 'Счета-фактуры Didox', description: 'Электронные счета-фактуры Didox: синхронизация, проверка и экспорт в 1С' },
      bank: { label: 'Банковские выписки', description: 'Загрузка выписок, правила, сверка и экспорт в 1С' },
      onec: { label: 'Импорт в 1С и история', description: 'Подключение к 1С, пакеты импорта, контрагенты и история выгрузок' },
    },
    admin: {
      title: 'Модули',
      hint: 'Какие разделы открыты пользователям, показаны как «скоро» или скрыты. Изменение вступает в силу везде в течение 30 секунд.',
      module: 'Модуль',
      state: 'Состояние',
      enabled: 'Включён',
      comingSoon: 'Скоро',
      hidden: 'Скрыт',
      save: 'Сохранить',
      saved: 'Сохранено',
      failed: 'Не удалось сохранить. Попробуйте снова.',
    },
  },
};
