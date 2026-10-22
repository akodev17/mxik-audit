// Uzbek (Latin) UI strings; the Russian mirror is in i18n-ru.ts.
//
// `Dict` is an exhaustive record type, so a missing key in either language
// does not compile.
//
// Every apostrophe below is U+02BB (ʻ) or U+02BC (ʼ) — never an ASCII quote.
// Accountants notice, and Gate 0 found the correct character in only 74 of
// 438,925 rows of the official export, so the bar is low and worth clearing.

import { fmtNumber } from './format';
import { ru } from './i18n-ru';

const nu = (v: number): string => fmtNumber('uz', v);

export type Locale = 'uz' | 'ru';

export const LOCALES: Locale[] = ['uz', 'ru'];

/** Any stored or submitted value as a supported locale. */
export function parseLocale(value: unknown): Locale {
  return LOCALES.find((l) => l === value) ?? DEFAULT_LOCALE;
}
export const DEFAULT_LOCALE: Locale = 'uz';

export type Dict = {
  // chrome
  appName: string;
  tagline: string;
  signIn: string;
  signOut: string;
  email: string;
  password: string;
  signInAction: string;
  signInError: string;

  // navigation
  navUpload: string;
  navCatalogs: string;

  // clients
  clientLabel: string;
  clientsTitle: string;
  clientsHint: string;
  clientsName: string;
  clientsLastAudit: string;
  clientsTrend: string;
  clientsMarking: string;
  clientsLastNotice: string;
  clientsNever: string;
  clientsAdd: string;
  clientsNewName: string;
  clientsDefault: string;
  clientsBadName: string;
  clientCatalogs: string;
  clientHistory: string;
  clientHistoryEmpty: string;
  clientUpload: string;
  clientNoCatalogs: string;
  historyAction: Record<string, string>;
  uploadClient: string;
  notificationsTitle: string;
  notificationsHint: string;
  notificationsEmpty: string;
  notificationsOpen: string;

  // settings and Telegram
  settingsTitle: string;
  tgSection: string;
  tgOff: string;
  tgIntro: (bot: string | null) => string;
  tgGetCode: string;
  tgCodeShown: (code: string, minutes: number) => string;
  tgLinkedChats: string;
  tgNoChats: string;
  tgUnlink: string;
  tgDemoOff: string;
  tgHelp: string;
  tgHelpLinked: string;
  tgLinked: (org: string) => string;
  tgBadCode: string;
  tgDemo: string;
  tgBadType: string;
  tgTooBig: string;
  tgChooseClient: (file: string) => string;
  tgExpired: string;
  tgEmptyFile: string;
  tgNoNames: string;
  tgStarted: (client: string, rows: number) => string;
  tgAuditDone: (client: string) => string;
  tgAuditFailed: (file: string) => string;
  tgFile: string;
  tgReport: string;
  tgError: string;

  // client PDF and branding
  pdfTitle: string;
  pdfStatus: string;
  pdfDate: string;
  pdfClassifier: string;
  pdfTruncated: (n: number) => string;
  pdfDisclaimer: string;
  pdfPage: (page: number, total: number) => string;
  brandSection: string;
  brandHint: string;
  brandName: string;
  brandLogo: string;
  brandLogoHint: string;
  brandSave: string;
  brandSaved: string;
  brandRemoveLogo: string;
  brandBadLogo: string;

  // purchases (Kirim) and NOT_PURCHASED
  typeNotPurchased: string;
  typePrivilegeCode: string;
  typePrivilegeOpportunity: string;
  typeRestricted: string;
  /** A finding type this build does not know yet (src/lib/finding-type.ts). */
  typeOther: string;
  purchasesNav: string;
  purchasesTitle: string;
  purchasesHint: string;
  purchasesTemplate: string;
  purchasesUpload: string;
  purchasesApply: string;
  purchasesLists: string;
  purchasesNone: string;
  purchasesCodes: string;
  purchasesDelete: string;
  purchasesStatus: Record<string, string>;
  activityLabel: string;
  activityOptions: Record<'savdo' | 'ishlab_chiqarish' | 'boshqa', string>;
  activityHint: string;

  // catalogue history and deletion
  catalogsTitle: string;
  catalogsHint: string;
  catalogsFile: string;
  catalogsDate: string;
  catalogsRows: string;
  catalogsRisky: string;
  catalogsStatus: string;
  catalogsDelete: string;
  catalogsDeleteConfirm: (filename: string) => string;
  catalogStatus: Record<'uploaded' | 'analyzing' | 'ready' | 'failed', string>;
  catalogAnalyzing: (done: number, total: number) => string;
  catalogAnalyzingHint: string;
  catalogNotAudited: string;
  catalogFailed: string;
  catalogRetry: string;

  // undo and decision history
  reviewUndoFailed: string;

  // admin traction metrics
  adminTitle: string;
  adminHint: string;
  adminOrgs: string;
  adminCatalogs: string;
  adminRowsAudited: string;
  adminRiskyRows: string;
  adminLast30: (n: number) => string;
  adminByType: string;
  adminDecisions: string;
  adminAccepted: string;
  adminEdited: string;
  adminRejected: string;
  adminPending: string;
  adminBulk: string;
  adminUndone: string;
  adminReviewTime: string;
  adminReviewValue: (seconds: number | null) => string;
  adminReviewNote: (samples: number) => string;
  adminDemo: string;
  adminLeads: string;
  adminLeadsFiles: (n: number) => string;
  adminGenerated: string;
  adminPipeline: string;

  // demo
  demoTitle: string;
  demoIntro: string;
  demoPoints: string[];
  demoStart: string;
  demoUnavailable: string;
  demoUploadDisabled: string;
  demoAccess: {
    name: string; company: string; email: string; emailHint: string; useCase: string;
    uses: { own_company: string; clients: string; evaluation: string; other: string };
    submit: string; sentTitle: string; sentBody: (email: string, minutes: number) => string; sentSpam: string; another: string;
    verifyTitle: string; verifyHello: (name: string) => string; verifyBody: (hours: number, idleMinutes: number) => string; open: string;
    invalidTitle: string; invalidBody: string; requestNew: string;
    errors: { invalid: string; email: string; disposable: string; rate: string; limit: string; link: string };
    mail: { subject: string; body: (link: string, minutes: number) => string };
  };

  // upload
  uploadTitle: string;
  uploadHint: string;
  uploadMapTitle: string;
  uploadColumnName: string;
  uploadColumnBarcode: string;
  uploadColumnMxik: string;
  uploadColumnUnit: string;
  uploadColumnPrice: string;
  uploadColumnSales: string;
  uploadPreset: string;
  uploadPresetAuto: string;
  uploadPresetHint: string;
  moneyTitle: string;
  moneyRisky: (amount: string) => string;
  moneyShare: (percent: string) => string;
  moneyNote: string;
  moneyFine: (amount: string) => string;
  moneyFineNote: string;
  uploadColumnIgnore: string;
  uploadRowsFound: (n: number) => string;
  uploadRemembered: string;

  // report
  reportHeadline: (risky: number, total: number) => string;
  reportClean: (total: number) => string;
  reportFilterType: string;

  // findings
  typeMissing: string;
  typeNotFound: string;
  typeMismatch: string;
  typeUnitConflict: string;

  // review
  reviewProduct: string;
  reviewCurrentCode: string;
  reviewSuggested: string;
  reviewNoCode: string;
  reviewPending: string;
  reviewAccepted: string;
  reviewRejected: string;
  markingBadge: string;
  markingCurrent: string;
  markingSuggested: string;
  groupAccept: (n: number) => string;
  groupReject: (n: number) => string;
  groupSplit: string;

  // export
  export1c: string;
  payTitle: string;
  payPrice: (price: string, rows: string) => string;
  payPaid: string;
  payLarge: string;
  payClick: string;
  payPayme: string;
  payNote: string;
  payRequired: string;
  subPrice: (price: string) => string;
  subUntil: (date: string) => string;
  subNone: string;

  // shared
  loading: string;
  errorGeneric: string;
  back: string;
  rows: string;
  code: string;
  confidenceSure: string;
  confidenceLikely: string;
  confidenceCheck: string;

  // what a code means, and why it was suggested
  codeArchived: string;
  codeUnknown: string;
};

export const uz: Dict = {
  appName: 'Tasnivo',
  tagline: 'Katalogingizdagi xavfli pozitsiyalarni aniqlang',
  signIn: 'Kirish',
  signOut: 'Chiqish',
  email: 'Elektron pochta',
  password: 'Parol',
  signInAction: 'Kirish',
  signInError: 'Elektron pochta yoki parol notoʻgʻri',

  navUpload: 'Yuklash',
  navCatalogs: 'Kataloglar',

  clientLabel: 'Mijoz',
  clientsTitle: 'Mijozlar',
  clientsHint: 'Har bir mijozning kataloglari, hisobotlari va tarixi alohida saqlanadi.',
  clientsName: 'Mijoz',
  clientsLastAudit: 'Oxirgi tahlil',
  clientsTrend: 'Xavfli qatorlar (oxirgi 5 tahlil)',
  clientsMarking: 'Markirovka',
  clientsLastNotice: 'Oxirgi xabarnoma',
  clientsNever: 'hali yoʻq',
  clientsAdd: 'Mijoz qoʻshish',
  clientsNewName: 'Mijoz nomi, masalan: “Baraka Savdo” MChJ',
  clientsDefault: 'asosiy',
  clientsBadName: 'Nomni kiriting (kamida 2 ta belgi).',
  clientCatalogs: 'Kataloglar',
  clientHistory: 'Tarix',
  clientHistoryEmpty: 'Hali hech narsa boʻlmagan.',
  clientUpload: 'Shu mijoz uchun katalog yuklash',
  clientNoCatalogs: 'Bu mijoz uchun hali katalog yuklanmagan.',
  historyAction: {
    'catalog.uploaded': 'Katalog yuklandi',
    'catalog.audited': 'Tahlil tugadi',
    'catalog.exported': 'Tuzatilgan fayl yuklab olindi',
    'catalog.deleted': 'Katalog oʻchirildi',
    'client.created': 'Mijoz qoʻshildi',
    'classifier.updated': 'Tasniflagich yangilandi',
  },
  uploadClient: 'Mijoz',
  notificationsTitle: 'Xabarnomalar',
  notificationsHint: 'Tasniflagich yangilanganda mijozlaringiz kataloglarida nima oʻzgargani shu yerda koʻrinadi. Telegram ulangan boʻlsa, u yerga ham yuboriladi.',
  notificationsEmpty: 'Hali xabarnoma yoʻq.',
  notificationsOpen: 'Hisobotni ochish',

  settingsTitle: 'Sozlamalar',
  tgSection: 'Telegram',
  tgOff: 'Telegram bot hozircha mavjud emas.',
  tgIntro: (bot) => `Botga katalog faylini yuboring — u tahlil qilinadi va natija shu chatga keladi. Tasniflagich yangilanganda xabarnomalar ham shu yerga keladi.${bot ? ` Bot: @${bot}.` : ''}`,
  tgGetCode: 'Ulash kodini olish',
  tgCodeShown: (code, minutes) => `Botga yuboring: /start ${code} — kod ${minutes} daqiqa amal qiladi va bir marta ishlatiladi.`,
  tgLinkedChats: 'Ulangan chatlar',
  tgNoChats: 'Hali hech qanday chat ulanmagan.',
  tgUnlink: 'Uzish',
  tgDemoOff: 'Demo rejimida Telegram ulanmaydi.',
  tgHelp: 'Salom! Bu Tasnivo boti. Ulash uchun veb-ilovada Sozlamalar → Telegram boʻlimidan kod oling va shu yerga “/start KOD” deb yuboring.',
  tgHelpLinked: 'Katalog faylini (.xlsx yoki .csv) shu chatga yuboring — tahlil qilib, natijani yuboraman.',
  tgLinked: (org) => `Ulandi: ${org}. Endi katalog faylini (.xlsx yoki .csv) yuborishingiz mumkin.`,
  tgBadCode: 'Kod notoʻgʻri yoki muddati oʻtgan. Veb-ilovada yangi kod oling.',
  tgDemo: 'Demo hisobni Telegramga ulab boʻlmaydi.',
  tgBadType: 'Faqat .xlsx yoki .csv fayl qabul qilinadi.',
  tgTooBig: 'Fayl juda katta (20 MB dan oshmasligi kerak).',
  tgChooseClient: (file) => `“${file}” qaysi mijozniki?`,
  tgExpired: 'Bu soʻrov eskirgan. Faylni qaytadan yuboring.',
  tgEmptyFile: 'Faylda maʼlumot qatorlari topilmadi.',
  tgNoNames: 'Faylda tovar nomlari ustuni topilmadi. Faylni veb-ilova orqali yuklab, ustunlarni koʻrsating.',
  tgStarted: (client, rows) => `Qabul qilindi: ${client}, ${nu(rows)} qator. Tahlil tugagach natija shu yerga keladi.`,
  tgAuditDone: (client) => `Tahlil tugadi — ${client}`,
  tgAuditFailed: (file) => `“${file}” tahlili xatolik bilan toʻxtadi. Veb-ilovada qayta urinib koʻring.`,
  tgFile: 'Fayl',
  tgReport: 'Hisobot',
  tgError: 'Xatolik yuz berdi. Birozdan soʻng qayta urinib koʻring.',

  pdfTitle: 'MXIK audit hisoboti',
  pdfStatus: 'Holat',
  pdfDate: 'Hisobot sanasi',
  pdfClassifier: 'Tasniflagich versiyasi',
  pdfTruncated: (n) => `Birinchi ${nu(n)} ta xavfli qator koʻrsatilgan; toʻliq roʻyxat ilovada.`,
  pdfDisclaimer: 'Kodlar avtomatik tahlil asosida taklif qilingan; har bir qaror foydalanuvchi tomonidan qabul qilinadi. Ushbu hisobot yuridik maslahat emas.',
  pdfPage: (page, total) => `${page} / ${total}`,
  brandSection: 'Mijoz hisobotlari (PDF)',
  brandHint: 'PDF hisobotda shu nom va logotip chiqadi.',
  brandName: 'Firma nomi',
  brandLogo: 'Logotip',
  brandLogoHint: 'PNG yoki JPEG, 300 KB gacha.',
  brandSave: 'Saqlash',
  brandSaved: 'Saqlandi.',
  brandRemoveLogo: 'Logotipni oʻchirish',
  brandBadLogo: 'Logotip PNG yoki JPEG boʻlishi va 300 KB dan oshmasligi kerak.',

  typeNotPurchased: 'Xaridlarda yoʻq',
  typePrivilegeCode: 'Imtiyozli kod',
  typePrivilegeOpportunity: 'Imtiyoz imkoniyati',
  typeRestricted: 'EHFda cheklangan kod',
  typeOther: 'Boshqa turdagi muammo',
  purchasesNav: 'Kirim (xaridlar)',
  purchasesTitle: 'Kirim (xaridlar)',
  purchasesHint: 'Mijozning xaridlar roʻyxatini yuklang: kirim EHF eksporti yoki istalgan Excel/CSV roʻyxat. Katalogdagi kodlar xaridlardagi MXIK kodlari (va oʻlchov birligi) bilan solishtiriladi.',
  purchasesTemplate: 'Shablonni yuklab olish',
  purchasesUpload: 'Xaridlar faylini tanlash',
  purchasesApply: 'Solishtirishni boshlash',
  purchasesLists: 'Yuklangan roʻyxatlar',
  purchasesNone: 'Hali xaridlar roʻyxati yuklanmagan — xaridlar bilan solishtirish oʻtkazilmaydi.',
  purchasesCodes: 'MXIK kodlari',
  purchasesDelete: 'Oʻchirish',
  purchasesStatus: { uploaded: 'Ustunlar tanlanmagan', ready: 'Ishlatilmoqda' },
  activityLabel: 'Faoliyat turi',
  activityOptions: { savdo: 'Savdo', ishlab_chiqarish: 'Ishlab chiqarish', boshqa: 'Boshqa' },
  activityHint: 'Savdo uchun xaridlarda topilmagan tovar yuqori risk sifatida koʻrsatiladi; qolganlar uchun — maʼlumot uchun.',

  catalogsTitle: 'Yuklangan kataloglar',
  catalogsHint: 'Har qanday katalogning hisoboti, koʻrib chiqilishi va eksporti saqlanadi. Katalogni oʻchirsangiz, undan olingan barcha maʼlumotlar ham oʻchiriladi.',
  catalogsFile: 'Fayl',
  catalogsDate: 'Sana',
  catalogsRows: 'Qatorlar',
  catalogsRisky: 'Xavfli',
  catalogsStatus: 'Holat',
  catalogsDelete: 'Oʻchirish',
  catalogsDeleteConfirm: (filename) =>
    `“${filename}” katalogi butunlay oʻchiriladi: qatorlar, takliflar va qarorlar tarixi bilan birga. Buni qaytarib boʻlmaydi. Davom etasizmi?`,
  catalogStatus: { uploaded: 'Tahlil qilinmagan', analyzing: 'Tahlil qilinmoqda', ready: 'Tayyor', failed: 'Xatolik' },
  catalogAnalyzing: (done, total) =>
    `Tahlil qilinmoqda: ${nu(done)} / ${nu(total)} qator`,
  catalogAnalyzingHint: 'Sahifa oʻzi yangilanadi. Katta katalog bir necha daqiqa olishi mumkin; sahifani yopsangiz ham tahlil davom etadi.',
  catalogNotAudited: 'Bu katalog hali tahlil qilinmagan: ustunlar moslashtirilishi tasdiqlanmagan.',
  catalogFailed: 'Tahlil xatolik bilan toʻxtadi.',
  catalogRetry: 'Qayta tahlil qilish',

  reviewUndoFailed: 'Bekor qilib boʻlmadi: bu qaror allaqachon bekor qilingan.',

  adminTitle: 'Koʻrsatkichlar',
  adminHint: 'Faqat haqiqiy mijozlar hisoblanadi: demo nusxalar, demo shabloni va ichki (namuna, sinov) tashkilotlar kiritilmagan.',
  adminOrgs: 'Mijoz tashkilotlar',
  adminCatalogs: 'Yuklangan kataloglar',
  adminRowsAudited: 'Tahlil qilingan qatorlar',
  adminRiskyRows: 'Xavfli qatorlar',
  adminLast30: (n) => `oxirgi 30 kunda: ${nu(n)}`,
  adminByType: 'Topilmalar turi boʻyicha',
  adminDecisions: 'Takliflar boʻyicha qarorlar',
  adminAccepted: 'Tasdiqlandi (taklif etilgan kod)',
  adminEdited: 'Tasdiqlandi (boshqa kod tanlandi)',
  adminRejected: 'Rad etildi',
  adminPending: 'Koʻrib chiqilmagan',
  adminBulk: 'Birdaniga qabul qilingan qatorlar',
  adminUndone: 'Bekor qilingan qarorlar',
  adminReviewTime: 'Bir qatorni koʻrib chiqish vaqti (mediana)',
  adminReviewValue: (s) => (s === null ? 'hali maʼlumot yoʻq' : `${nu(s)} soniya`),
  adminReviewNote: (n) => `${nu(n)} ta oraliq asosida; 10 daqiqadan uzun tanaffuslar hisobga olinmaydi.`,
  adminDemo: 'Demo sessiyalar',
  adminLeads: 'Bepul audit soʻrovlari',
  adminLeadsFiles: (n) => `fayl bilan: ${nu(n)}`,
  adminGenerated: 'Hisoblangan vaqt',
  adminPipeline: 'Taklif tizimi holati (faqat administratorga koʻrinadi)',

  demoTitle: 'Demoni sinab koʻrish',
  demoIntro: 'Ish e-pochtangizni tasdiqlang — namuna katalog ustida dasturning toʻliq ishini koʻrasiz: risk hisoboti, takliflarni koʻrib chiqish va tuzatilgan faylni yuklab olish. Tasdiqlash havolasi e-pochtaga yuboriladi, parol kerak emas.',
  demoPoints: [
    'Katalog oʻylab topilgan: real kompaniya maʼlumotlari ishlatilmagan.',
    'Har bir tashrif oʻz nusxasini oladi — qarorlaringizni boshqalar koʻrmaydi.',
    'Demo rejimida fayl yuklash oʻchirilgan.',
    'Demo 24 soatdan keyin yoki 30 daqiqa faolsizlikdan soʻng yopiladi.',
  ],
  demoStart: 'Demoni boshlash',
  demoUnavailable: 'Demo hozircha tayyor emas. Birozdan soʻng qayta urinib koʻring.',
  demoUploadDisabled: 'Demo rejimida fayl yuklash oʻchirilgan. Oʻz katalogingizni tekshirish uchun bosh sahifadagi forma orqali yuboring.',
  demoAccess: {
    name: 'Ismingiz',
    company: 'Kompaniya',
    email: 'Ish e-pochtasi',
    emailHint: 'Demo havolasi shu manzilga yuboriladi.',
    useCase: 'Demoni nima uchun koʻrmoqchisiz?',
    uses: {
      own_company: 'Oʻz kompaniyamning katalogi uchun',
      clients: 'Mijozlarimning kataloglari uchun',
      evaluation: 'Dasturni baholash uchun',
      other: 'Boshqa maqsadda',
    },
    submit: 'Demo havolasini yuborish',
    sentTitle: 'E-pochtangizni tekshiring',
    sentBody: (email, minutes) => `Demoga kirish havolasini ${email} manziliga yubordik. U ${minutes} daqiqa amal qiladi va bir marta ishlaydi.`,
    sentSpam: 'Xat kelmasa, “Spam” papkasini tekshiring.',
    another: 'Boshqa manzilga yuborish',
    verifyTitle: 'Demoga kirish',
    verifyHello: (name) => `${name}, demo tayyor.`,
    verifyBody: (hours, idle) => `Demo ${hours} soatdan keyin yoki ${idle} daqiqa faolsizlikdan soʻng yopiladi. Maʼlumotlar oʻylab topilgan, qarorlaringizni boshqalar koʻrmaydi.`,
    open: 'Demoni ochish',
    invalidTitle: 'Havola ishlamaydi',
    invalidBody: 'Havola allaqachon ishlatilgan yoki muddati tugagan. Yangisini soʻrang.',
    requestNew: 'Yangi havola soʻrash',
    errors: {
      invalid: 'Ism, kompaniya va maqsadni toʻldiring.',
      email: 'E-pochta manzilini toʻgʻri kiriting.',
      disposable: 'Vaqtinchalik e-pochta xizmatlari qabul qilinmaydi. Ish e-pochtangizdan foydalaning.',
      rate: 'Soʻrovlar juda koʻp. Birozdan soʻng qayta urinib koʻring.',
      limit: 'Bu manzil uchun bugungi demolar soni tugadi. Ertaga qayta urinib koʻring.',
      link: 'Havola ishlatilgan yoki muddati tugagan. Yangisini soʻrang.',
    },
    mail: {
      subject: 'Tasnivo demosiga kirish havolasi',
      body: (link, minutes) => `Tasnivo demosiga kirish uchun havolani oching (${minutes} daqiqa amal qiladi, bir marta ishlaydi):

${link}

Agar demo soʻramagan boʻlsangiz, bu xatga eʼtibor bermang.`,
    },
  },

  uploadTitle: 'Katalogni yuklash',
  uploadHint: 'Excel (.xlsx) yoki CSV fayl. Sarlavha qatori avtomatik aniqlanadi; ustunlarni keyingi qadamda tasdiqlaysiz.',
  uploadMapTitle: 'Ustunlarni moslashtirish',
  uploadColumnName: 'Tovar nomi',
  uploadColumnBarcode: 'Shtrix kod',
  uploadColumnMxik: 'MXIK kodi',
  uploadColumnUnit: 'Oʻlchov birligi',
  uploadColumnPrice: 'Narx',
  uploadColumnSales: 'Sotuv summasi',
  uploadPreset: 'Fayl qayerdan',
  uploadPresetAuto: 'Avtomatik aniqlash',
  uploadPresetHint: '“Taxminiy” andozalar haqiqiy fayl bilan tekshirilmagan — ustunlarni koʻzdan kechiring.',
  moneyTitle: 'Xavfli qatorlar boʻyicha sotuv summasi (taxminiy)',
  moneyRisky: (amount) => `${amount} soʻm`,
  moneyShare: (percent) => `faylingizdagi jami sotuvning ${percent}%`,
  moneyNote: 'Faylingizdagi “Sotuv summasi” ustuni boʻyicha hisoblangan taxminiy summa. Xavfli qator — yuqori yoki oʻrta muhimlikdagi kamida bitta topilmasi bor qator. Bu jarima miqdori emas.',
  moneyFine: (amount) => `Taxminiy jarima: ${amount} soʻm (xavfli sotuvning 1%)`,
  moneyFineNote: 'Taxminiy; har bir hisobvaraq-faktura alohida koʻriladi.',
  uploadColumnIgnore: '— hisobga olinmaydi —',
  uploadRowsFound: (n) => `${nu(n)} qator topildi`,
  uploadRemembered: 'Oldingi yuklashdagi moslashtirish saqlangan.',

  reportHeadline: (risky, total) =>
    `${nu(total)} pozitsiyadan ${nu(risky)} tasi xavfli`,
  reportClean: (total) =>
    `${nu(total)} pozitsiyaning barchasi tekshiruvdan oʻtdi`,
  reportFilterType: 'Turi',

  typeMissing: 'Kod yoʻq',
  typeNotFound: 'Tasniflagichda yoʻq',
  typeMismatch: 'Nomga mos emas',
  typeUnitConflict: 'Oʻlchov birligi',

  reviewProduct: 'Tovar',
  reviewCurrentCode: 'Hozirgi kod',
  reviewSuggested: 'Taklif etilgan kod',
  reviewNoCode: 'kod yoʻq',
  reviewPending: 'Koʻrib chiqilmagan',
  reviewAccepted: 'Tasdiqlandi',
  reviewRejected: 'Rad etildi',
  markingBadge: 'Markirovka talab qilinadi',
  markingCurrent: 'hozirgi kod',
  markingSuggested: 'taklif etilgan kod',
  groupAccept: (n) => `${n} ta qatorni qabul qilish`,
  groupReject: (n) => `${n} ta qatorni rad etish`,
  groupSplit: 'Guruhdan ajratish',

  export1c: '1C uchun CSV',
  payTitle: 'Toʻgʻrilangan katalog',
  payPrice: (price, rows) => `${price} soʻm · ${rows} SKU gacha`,
  payPaid: 'Toʻlangan.',
  payLarge: '10 000 dan ortiq qatorli katalog uchun narx alohida kelishiladi.',
  payClick: 'Click orqali toʻlash',
  payPayme: 'Payme orqali toʻlash',
  payNote: 'Toʻlov Click yoki Payme sahifasida amalga oshiriladi; tasdiqlangach shu yerda “Toʻlangan” deb koʻrinadi.',
  payRequired: 'Tuzatilgan faylni yuklab olish uchun avval katalog uchun toʻlang yoki firma obunasini faollashtiring.',
  subPrice: (price) => `${price} soʻm / oy`,
  subUntil: (date) => `Faol: ${date} gacha`,
  subNone: 'Obuna faol emas.',

  loading: 'Yuklanmoqda…',
  errorGeneric: 'Xatolik yuz berdi. Qaytadan urinib koʻring.',
  back: 'Orqaga',
  rows: 'qator',
  code: 'Kod',
  confidenceSure: 'Yuqori moslik',
  confidenceLikely: 'Oʻrtacha moslik',
  confidenceCheck: 'Past moslik',

  codeArchived: 'Tasniflagichdan chiqarilgan',
  codeUnknown: 'Tasniflagichda topilmadi',
};

const DICTS: Record<Locale, Dict> = { uz, ru };

export function dict(locale: Locale = DEFAULT_LOCALE): Dict {
  return DICTS[locale];
}

/** Uzbek default, for code that is not tied to a request (scripts, tests). */
export const t: Dict = uz;
