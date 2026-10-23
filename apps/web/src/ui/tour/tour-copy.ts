'use client';

// placeholder until i18n-parts/tour.ts lands (T1.3): same shape as `ta.tourX`, words from the plan's draft.
// The swap: delete this file and make useTourCopy() return `useI18n().ta.tourX`.
import { useI18n } from '@/lib/locale-client';
import type { Locale } from '@tasnivo/i18n/i18n';
import type { StepKey } from './tour-steps';

export type TourCopy = {
  _area: 'tour';
  label: string;
  counter: (n: number, total: number) => string;
  next: string;
  back: string;
  skip: string;
  done: string;
  open: string;
  menuEntry: string;
  settingsTitle: string;
  settingsHint: string;
  settingsButton: string;
  steps: Record<StepKey, { title: string; body: string }>;
};

const uz: { tourX: TourCopy } = {
  tourX: {
    _area: 'tour',
    label: 'Platforma bilan tanishuv',
    counter: (n, total) => `${n} / ${total}`,
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
      welcome: { title: 'Xush kelibsiz!', body: 'Tasnivo bilan 2 daqiqada tanishib chiqamiz. Istalgan payt «Oʻtkazib yuborish»ni bosing.' },
      dashboard: { title: 'Bosh sahifa', body: 'Bu yerda nima qilish kerakligi koʻrinadi: yangi topilmalar, mijozlar va birinchi qadamlar roʻyxati.' },
      upload: { title: 'Katalog yuklash', body: 'Excel yoki CSV faylni shu yerdan yuklang. Ustunlarni dastur oʻzi taniydi.' },
      catalogs: { title: 'Kataloglar va natija', body: 'Har bir yuklangan katalog shu yerda. Ichida: xavfli qatorlar, taklif qilingan MXIK kodlari va hisobot.' },
      queue: { title: 'Koʻrib chiqish navbati', body: 'Qaror kutayotgan qatorlar bir roʻyxatda. Taklifni tasdiqlaysiz yoki rad etasiz.' },
      clients: { title: 'Mijozlar', body: 'Har bir korxona uchun alohida mijoz: kataloglari va tarixi ajratilgan.' },
      products: { title: 'Mahsulotlar katalogi', body: 'Firmangiz va mijozlaringiz mahsulotlari bir joyda: MXIK, qadoq kodi va oʻlchov birligi tekshiriladi.' },
      bank: { title: 'Bank koʻchirmalari', body: 'Bankdan olingan Excel koʻchirmani yuklang: operatsiyalar va kontragentlar aniqlanadi, 1C uchun fayl chiqadi.' },
      didox: { title: 'Didox hisob-fakturalar', body: 'Kiruvchi hisob-fakturalarni Didox arxividan yuklang. Mahsulotlar MXIK bilan solishtiriladi.' },
      onec: { title: '1C import va tarix', body: 'Bank, Didox va katalog paketlari shu yerda: tekshiring, tasdiqlang va 1C uchun faylni yuklab oling.' },
      dictionary: { title: 'Firma lugʻati', body: 'Bir marta tasdiqlangan kod eslab qolinadi: keyingi katalogda shu tovar toʻgʻri kodni oʻzi oladi.' },
      activity: { title: 'Harakatlar', body: 'Kim, qachon, nimani tasdiqlagani yoki rad etgani: hammasi shu jurnalda.' },
      settings: { title: 'Sozlamalar va yordam', body: 'Hisob, xavfsizlik va tarif shu menyuda. Bu tanishuvni ham shu yerdan qayta ochasiz.' },
      done: { title: 'Tayyor!', body: 'Birinchi qadam: katalog yuklang. Savol boʻlsa, Yordam markazi doim yonida.' },
    },
  },
};

const ru: { tourX: TourCopy } = {
  tourX: {
    _area: 'tour',
    label: 'Знакомство с платформой',
    counter: (n, total) => `${n} / ${total}`,
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
      welcome: { title: 'Добро пожаловать!', body: 'За две минуты покажем, где что находится. Пропустить можно в любой момент.' },
      dashboard: { title: 'Главная', body: 'Здесь видно, что требует внимания: новые находки, клиенты и список первых шагов.' },
      upload: { title: 'Загрузка каталога', body: 'Загрузите файл Excel или CSV. Столбцы распознаются автоматически.' },
      catalogs: { title: 'Каталоги и результат', body: 'Каждый загруженный каталог здесь. Внутри: рискованные строки, предложенные коды ИКПУ и отчёт.' },
      queue: { title: 'Очередь проверки', body: 'Строки, ждущие решения, в одном списке. Предложение можно принять или отклонить.' },
      clients: { title: 'Клиенты', body: 'Отдельный клиент для каждой компании: каталоги и история хранятся раздельно.' },
      products: { title: 'Каталог товаров', body: 'Товары фирмы и клиентов в одном месте: проверяются ИКПУ, код упаковки и единица измерения.' },
      bank: { title: 'Банковские выписки', body: 'Загрузите выписку из банка в Excel: операции и контрагенты распознаются, на выходе файл для 1С.' },
      didox: { title: 'Счета-фактуры Didox', body: 'Загрузите входящие счета-фактуры из архива Didox. Товары сверяются с ИКПУ.' },
      onec: { title: 'Импорт в 1С и история', body: 'Пакеты из банка, Didox и каталогов здесь: проверьте, подтвердите и скачайте файл для 1С.' },
      dictionary: { title: 'Словарь фирмы', body: 'Подтверждённый код запоминается: в следующем каталоге тот же товар получит его автоматически.' },
      activity: { title: 'Журнал действий', body: 'Кто, когда и что подтвердил или отклонил: всё в этом журнале.' },
      settings: { title: 'Настройки и помощь', body: 'Аккаунт, безопасность и тариф в этом меню. Здесь же можно снова открыть эту экскурсию.' },
      done: { title: 'Готово!', body: 'Первый шаг: загрузите каталог. Если возникнут вопросы, Центр помощи всегда рядом.' },
    },
  },
};

const PLACEHOLDER: Record<Locale, TourCopy> = { uz: uz.tourX, ru: ru.tourX };

/** The tour's words in the interface language. */
export function useTourCopy(): TourCopy {
  const { locale } = useI18n();
  return PLACEHOLDER[locale];
}
