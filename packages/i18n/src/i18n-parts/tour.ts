// The first-login product tour (apps/web/src/ui/tour): the card's controls, the re-open entries in
// the user menu and Settings → Account, and one title + body per step. Step titles reuse the app's
// own section labels (nav.*, shellX.nav.*, accountingX.nav.*); bodies say what a section is for in
// at most two short sentences. Uzbek Latin first; the Russian object must have the same shape.

/** The tour's steps in display order; the engine's step list uses the same keys. */
export const TOUR_STEP_KEYS = [
  'welcome', 'dashboard', 'upload', 'catalogs', 'queue', 'clients', 'products',
  'bank', 'didox', 'onec', 'dictionary', 'activity', 'settings', 'done',
] as const;

export type TourStepKey = (typeof TOUR_STEP_KEYS)[number];

type TourStep = { title: string; body: string };

export const uz = {
  tourX: {
    _area: 'tour',
    label: 'Platforma bilan tanishuv',
    counter: (n: number, total: number) => `${n} / ${total}`,
    next: 'Keyingi',
    back: 'Orqaga',
    skip: 'Oʻtkazib yuborish',
    done: 'Boshlash',
    open: 'Boʻlimni ochish',
    menuEntry: 'Platformani oʻrganish',
    settingsTitle: 'Platforma bilan tanishuv',
    settingsHint: 'Asosiy boʻlimlar boʻyicha qisqa yoʻl-yoʻriq, 2 daqiqa.',
    settingsButton: 'Tanishuvni qayta koʻrish',
    steps: {
      welcome: {
        title: 'Xush kelibsiz!',
        body: '2 daqiqada asosiy boʻlimlarni koʻrsatamiz. Istalgan payt «Oʻtkazib yuborish»ni bosing.',
      },
      dashboard: {
        title: 'Bosh sahifa',
        body: 'Bu yerda nimaga eʼtibor berish kerakligi koʻrinadi: yangi topilmalar, mijozlar va birinchi qadamlar.',
      },
      upload: {
        title: 'Katalog yuklash',
        body: 'Excel yoki CSV faylni shu yerdan yuklang. Ustunlarni dastur oʻzi taniydi.',
      },
      catalogs: {
        title: 'Kataloglar',
        body: 'Yuklangan har bir katalog shu yerda. Ichida: xavfli qatorlar, taklif qilingan MXIK kodlari va hisobot.',
      },
      queue: {
        title: 'Koʻrib chiqish navbati',
        body: 'Qaror kutayotgan qatorlar bitta roʻyxatda. Har bir taklifni tasdiqlaysiz yoki rad etasiz.',
      },
      clients: {
        title: 'Mijozlar',
        body: 'Har bir korxona alohida mijoz: kataloglari va tarixi aralashmaydi. Hamkasblarga faqat kerakli mijozlarni ochasiz.',
      },
      products: {
        title: 'Mahsulotlar katalogi',
        body: 'Firma va mijozlar mahsulotlari bir joyda: MXIK, qadoq kodi va oʻlchov birligi tekshiriladi. 1C uchun fayl ham tayyorlanadi.',
      },
      bank: {
        title: 'Bank koʻchirmalari',
        body: 'Bankdan olingan Excel koʻchirmani yuklang. Operatsiyalar va kontragentlar aniqlanadi, 1C uchun fayl tayyorlanadi.',
      },
      didox: {
        title: 'Didox hisob-fakturalar',
        body: 'Kiruvchi hisob-fakturalarni Didox arxividan yuklang. Mahsulotlarning MXIK kodlari tekshiriladi va 1C ga tayyorlanadi.',
      },
      onec: {
        title: '1C import va tarix',
        body: 'Bank, Didox va mahsulotlar paketlari shu yerda: tekshiring, tasdiqlang va 1C uchun faylni yuklab oling.',
      },
      dictionary: {
        title: 'Lugʻat',
        body: 'Bir marta tasdiqlangan kod eslab qolinadi. Keyingi katalogda shu tovarga oʻsha kod taklif qilinadi.',
      },
      activity: {
        title: 'Harakatlar',
        body: 'Kim, qachon va nimani tasdiqlagan yoki rad etgan: hammasi shu jurnalda.',
      },
      settings: {
        title: 'Sozlamalar va yordam',
        body: 'Til, mavzu, sozlamalar va Yordam markazi shu menyuda. Bu tanishuvni ham shu yerdan qayta ochasiz.',
      },
      done: {
        title: 'Tayyor!',
        body: 'Birinchi qadam: katalog yuklang. Savol boʻlsa, Yordam markazi doim yonida.',
      },
    } satisfies Record<TourStepKey, TourStep>,
  },
};

export const ru: typeof uz = {
  tourX: {
    _area: 'tour',
    label: 'Знакомство с платформой',
    counter: (n: number, total: number) => `${n} / ${total}`,
    next: 'Далее',
    back: 'Назад',
    skip: 'Пропустить',
    done: 'Начать',
    open: 'Открыть раздел',
    menuEntry: 'Экскурсия по платформе',
    settingsTitle: 'Знакомство с платформой',
    settingsHint: 'Короткая экскурсия по основным разделам, 2 минуты.',
    settingsButton: 'Показать экскурсию снова',
    steps: {
      welcome: {
        title: 'Добро пожаловать!',
        body: 'За 2 минуты покажем основные разделы. Пропустить можно в любой момент.',
      },
      dashboard: {
        title: 'Главная',
        body: 'Здесь видно, что требует внимания: новые замечания, клиенты и первые шаги.',
      },
      upload: {
        title: 'Загрузить каталог',
        body: 'Загрузите файл Excel или CSV. Столбцы распознаются автоматически.',
      },
      catalogs: {
        title: 'Каталоги',
        body: 'Здесь каждый загруженный каталог. Внутри: рискованные строки, предложенные коды ИКПУ и отчёт.',
      },
      queue: {
        title: 'Очередь проверки',
        body: 'Строки, ждущие решения, собраны в одном списке. Каждое предложение можно принять или отклонить.',
      },
      clients: {
        title: 'Клиенты',
        body: 'Каждая компания — отдельный клиент: каталоги и история не смешиваются. Коллегам можно открыть только нужных клиентов.',
      },
      products: {
        title: 'Каталог товаров',
        body: 'Товары фирмы и клиентов в одном месте: проверяются ИКПУ, код упаковки и единица измерения. Готовится и файл для 1С.',
      },
      bank: {
        title: 'Банковские выписки',
        body: 'Загрузите выписку из банка в Excel. Операции и контрагенты распознаются, готовится файл для 1С.',
      },
      didox: {
        title: 'Счета-фактуры Didox',
        body: 'Загрузите входящие счета-фактуры из архива Didox. Коды ИКПУ товаров проверяются и готовятся для 1С.',
      },
      onec: {
        title: 'Импорт в 1С и история',
        body: 'Пакеты из банка, Didox и каталога товаров здесь: проверьте, подтвердите и скачайте файл для 1С.',
      },
      dictionary: {
        title: 'Словарь',
        body: 'Подтверждённый код запоминается. В следующем каталоге он будет предложен для того же товара.',
      },
      activity: {
        title: 'Действия',
        body: 'Кто, когда и что подтвердил или отклонил: всё в этом журнале.',
      },
      settings: {
        title: 'Настройки и помощь',
        body: 'Язык, тема, настройки и Центр помощи в этом меню. Здесь же можно снова открыть эту экскурсию.',
      },
      done: {
        title: 'Готово!',
        body: 'Первый шаг: загрузите каталог. Если возникнут вопросы, Центр помощи всегда рядом.',
      },
    },
  },
};
