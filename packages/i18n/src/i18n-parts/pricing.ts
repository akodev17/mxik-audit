// Plan names and pricing copy, shared by the landing page (Uzbek only), the settings plan tab, the
// help article and the API docs. Numbers are never written here: they come from
// packages/domain/src/billing/plans.ts (the landing repeats them in its PRICING config).
// Names follow docs/PRICING_PROPOSAL.md (set A, roles); the plan ids do not depend on them.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

type PlanKey = 'trial' | 'company' | 'accountant' | 'firm';

export const uz = {
  prX: {
    _area: 'pricing',
    eyebrow: 'Narxlar',
    title: 'Avval bepul koʻring, keyin ishingizga mos tarifni tanlang',
    lead: 'Koʻrikda nechta pozitsiya riskli ekanini va nima notoʻgʻriligini bepul koʻrasiz. Toʻgʻrilangan fayl va har oylik tekshiruv — obunada.',
    names: { trial: 'Koʻrik', company: 'Korxona', accountant: 'Buxgalter', firm: 'Byuro' } as Record<PlanKey, string>,
    forWhom: 'Kimlar uchun',
    who: {
      trial: 'Katalogidagi xatolarni birinchi marta koʻrmoqchi boʻlgan har kim',
      company: 'Bitta kompaniya: doʻkon, qurilish mollari sotuvchisi, distribyutor',
      accountant: 'Bir nechta mijozga xizmat qiladigan buxgalter yoki kichik firma',
      firm: 'Koʻp mijozli buxgalteriya autsorsing firmasi',
    } as Record<PlanKey, string>,
    period: { label: 'Toʻlov davri', monthly: 'Oylik', yearly: 'Yillik', yearlyBadge: '2 oy bepul' },
    free: 'Bepul',
    trialTerm: (days: number) => `${days} kun, karta kerak emas`,
    currency: 'soʻm',
    perMonth: '/ oy',
    perYear: '/ yil',
    yearlyEquivalent: (price: string) => `oyiga ${price} soʻm hisobida`,
    monthlyEquivalent: (price: string) => `yillik toʻlovda oyiga ${price} soʻm`,
    startBadge: 'Boshlash uchun',
    ctaFree: 'Bepul boshlash',
    ctaPaid: 'Koʻrikdan boshlash',
    features: {
      risks: 'Riskli pozitsiyalar va sabablari',
      suggestions: 'Kod takliflari va tasdiqlash',
      export: 'Toʻgʻrilangan fayl: Excel, 1C, PDF',
    },
    limits: {
      clients: 'Kompaniyalar',
      rows: 'Oyiga pozitsiyalar (SKU)',
      seats: 'Foydalanuvchilar',
      api: 'Oyiga API tekshiruvlari',
    },
    limitsTitle: 'Chegaralar',
    unlimited: 'cheklanmagan',
    included: 'Kiradi',
    excluded: 'Kirmaydi',
    oneOff: {
      title: 'Toʻgʻrilangan katalog',
      kicker: 'Bir martalik',
      text: 'Obunasiz: bitta katalogni bir marta tekshirib, tasdiqlangan kodlar qoʻyilgan faylni olasiz.',
      size: (rows: string) => `${rows} SKU gacha`,
      larger: 'Kattaroq katalog uchun narx alohida kelishiladi.',
      cta: 'Faylni yuborish',
    },
    payTransfer: 'Toʻlov bank oʻtkazmasi orqali, ish bajarilgandan keyin.',
    payOnline: 'Ilovada Click yoki Payme orqali ham toʻlash mumkin.',
  },
};

export const ru: typeof uz = {
  prX: {
    _area: 'pricing',
    eyebrow: 'Цены',
    title: 'Сначала посмотрите бесплатно, потом выберите тариф под свою работу',
    lead: 'В «Проверке» бесплатно видно, сколько позиций в зоне риска и что в них не так. Исправленный файл и ежемесячная проверка — в подписке.',
    names: { trial: 'Проверка', company: 'Предприятие', accountant: 'Бухгалтер', firm: 'Бюро' },
    forWhom: 'Для кого',
    who: {
      trial: 'Все, кто хочет впервые увидеть ошибки в каталоге',
      company: 'Одна компания: магазин, продавец стройматериалов, дистрибьютор',
      accountant: 'Бухгалтер или небольшая фирма с несколькими клиентами',
      firm: 'Аутсорсинговая бухгалтерская фирма с большим числом клиентов',
    },
    period: { label: 'Период оплаты', monthly: 'Помесячно', yearly: 'За год', yearlyBadge: '2 месяца бесплатно' },
    free: 'Бесплатно',
    trialTerm: (days: number) => `${days} ${pluralRu(days, 'день', 'дня', 'дней')}, без карты`,
    currency: 'сум',
    perMonth: '/ месяц',
    perYear: '/ год',
    yearlyEquivalent: (price: string) => `${price} сум в месяц`,
    monthlyEquivalent: (price: string) => `при оплате за год — ${price} сум в месяц`,
    startBadge: 'Для начала',
    ctaFree: 'Начать бесплатно',
    ctaPaid: 'Начать с проверки',
    features: {
      risks: 'Позиции в зоне риска и причины',
      suggestions: 'Предложения кодов и подтверждение',
      export: 'Исправленный файл: Excel, 1С, PDF',
    },
    limits: {
      clients: 'Компании',
      rows: 'Позиций (SKU) в месяц',
      seats: 'Пользователи',
      api: 'Проверок API в месяц',
    },
    limitsTitle: 'Лимиты',
    unlimited: 'без ограничений',
    included: 'Входит',
    excluded: 'Не входит',
    oneOff: {
      title: 'Исправленный каталог',
      kicker: 'Разово',
      text: 'Без подписки: один каталог проверяется один раз, вы получаете файл с подтверждёнными кодами.',
      size: (rows: string) => `до ${rows} SKU`,
      larger: 'Для каталога больше — цена по договорённости.',
      cta: 'Отправить файл',
    },
    payTransfer: 'Оплата банковским переводом, после выполнения работы.',
    payOnline: 'В приложении можно оплатить и через Click или Payme.',
  },
};
