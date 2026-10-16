// Uzbek (Latin) UI strings.
//
// `Dict` is an exhaustive record type, so adding a Russian mirror later is
// compiler-checked: a missing key will not compile. Per the brief, the Russian
// strings are deliberately not written yet.
//
// Every apostrophe below is U+02BB (ʻ) or U+02BC (ʼ) — never an ASCII quote.
// Accountants notice, and Gate 0 found the correct character in only 74 of
// 438,925 rows of the official export, so the bar is low and worth clearing.

export type Locale = 'uz';

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
  navReport: string;
  navReview: string;
  navExport: string;
  navCatalogs: string;
  navClients: string;

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
  clientsCreate: string;
  clientsDefault: string;
  clientsOpen: string;
  clientsBadName: string;
  clientCatalogs: string;
  clientHistory: string;
  clientHistoryEmpty: string;
  clientUpload: string;
  clientNoCatalogs: string;
  historyAction: Record<string, string>;
  uploadClient: string;
  notificationsNav: string;
  notificationsTitle: string;
  notificationsHint: string;
  notificationsEmpty: string;
  notificationsOpen: string;

  // catalogue history and deletion
  catalogsTitle: string;
  catalogsHint: string;
  catalogsEmpty: string;
  catalogsFile: string;
  catalogsDate: string;
  catalogsRows: string;
  catalogsRisky: string;
  catalogsStatus: string;
  catalogsOpen: string;
  catalogsDelete: string;
  catalogsDeleteConfirm: (filename: string) => string;
  catalogsDeleted: (rows: number) => string;
  catalogStatus: Record<'uploaded' | 'analyzing' | 'ready' | 'failed', string>;
  catalogSwitch: string;
  catalogAnalyzing: (done: number, total: number) => string;
  catalogAnalyzingHint: string;
  catalogNotAudited: string;
  catalogFailed: string;
  catalogRetry: string;
  exportNotReady: string;

  // undo and decision history
  reviewUndo: string;
  reviewUndoLast: string;
  reviewUndoFailed: string;
  reviewHistory: string;
  reviewHistoryEmpty: string;
  historyAccepted: string;
  historyRejected: string;
  historyBulk: (n: number) => string;
  historyUndone: (n: number) => string;

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
  demoBadge: string;
  demoBanner: (hours: number) => string;
  demoUploadDisabled: string;

  // upload
  uploadTitle: string;
  uploadHint: string;
  uploadDrop: string;
  uploadChoose: string;
  uploadMapTitle: string;
  uploadMapHint: string;
  uploadPreviewTitle: string;
  uploadColumnName: string;
  uploadColumnBarcode: string;
  uploadColumnMxik: string;
  uploadColumnUnit: string;
  uploadColumnPrice: string;
  uploadColumnIgnore: string;
  uploadRequiredName: string;
  uploadStart: string;
  uploadAnalyzing: string;
  uploadRowsFound: (n: number) => string;
  uploadRemembered: string;

  // report
  reportTitle: string;
  reportHeadline: (risky: number, total: number) => string;
  reportClean: (total: number) => string;
  reportBreakdownMissing: (n: number) => string;
  reportBreakdownNotFound: (n: number) => string;
  reportBreakdownMismatch: (n: number) => string;
  reportBreakdownUnit: (n: number) => string;
  reportFilterAll: string;
  reportFilterType: string;
  reportFilterSeverity: string;
  reportPrint: string;
  reportGoReview: string;
  reportEmpty: string;

  // findings
  typeMissing: string;
  typeNotFound: string;
  typeMismatch: string;
  typeUnitConflict: string;
  severityHigh: string;
  severityMedium: string;

  // review
  reviewTitle: string;
  reviewProduct: string;
  reviewCurrentCode: string;
  reviewSuggested: string;
  reviewAlternatives: string;
  reviewNoCode: string;
  reviewAccept: string;
  reviewReject: string;
  reviewPickOther: string;
  reviewAcceptAllAbove: string;
  reviewDecided: string;
  reviewPending: string;
  reviewAccepted: string;
  reviewRejected: string;
  reviewKeyboardHint: string;
  reviewBoundUnit: string;
  reviewHierarchy: string;
  reviewConfidence: string;
  reviewProgress: (done: number, total: number) => string;
  reviewNothingToReview: string;
  markingBadge: string;
  markingTooltip: (which: string) => string;
  markingCurrent: string;
  markingSuggested: string;
  markingSummary: (total: number, risky: number) => string;
  markingFilter: string;
  groupTitle: (n: number) => string;
  groupShow: string;
  groupHide: string;
  groupCurrentMixed: string;
  groupAccept: (n: number) => string;
  groupReject: (n: number) => string;
  groupDecided: (accepted: number, rejected: number) => string;
  groupSplit: string;
  groupCount: (n: number) => string;

  // export
  exportTitle: string;
  exportHint: string;
  exportSummary: (accepted: number, rejected: number, pending: number) => string;
  exportDownload: string;
  exportStatusColumn: string;
  exportStatusAccepted: string;
  exportStatusRejected: string;
  exportStatusPending: string;
  exportStatusOk: string;

  // shared
  loading: string;
  errorGeneric: string;
  back: string;
  rows: string;
  code: string;
  confidenceSure: string;
  confidenceLikely: string;
  confidenceCheck: string;
  confidenceDetail: (percent: number) => string;

  // what a code means, and why it was suggested
  codeArchived: string;
  codeUnknown: string;
  badgeBarcode: string;
  whyTitle: string;
  whyBarcode: string;
  whyExact: string;
  whyWords: (words: readonly string[]) => string;
  whyNoWords: string;
  whyUnitMatch: (unit: string) => string;
  whyUnitConflict: (rowUnit: string, codeUnit: string) => string;
  whyUnitUnknown: string;
  whyUnitNone: string;
  whyRerank: (reason: string) => string;
  whyRerankNone: string;
  whyScore: (percent: number) => string;
  exportPreviewTitle: string;
  exportPreviewEmpty: string;
  exportPreviewMore: (n: number) => string;
  exportBefore: string;
  exportAfter: string;
};

export const uz: Dict = {
  appName: 'MXIK Audit',
  tagline: 'Katalogingizdagi riskli pozitsiyalarni aniqlang',
  signIn: 'Kirish',
  signOut: 'Chiqish',
  email: 'Elektron pochta',
  password: 'Parol',
  signInAction: 'Kirish',
  signInError: 'Elektron pochta yoki parol notoʻgʻri',

  navUpload: 'Yuklash',
  navReport: 'Hisobot',
  navReview: 'Koʻrib chiqish',
  navExport: 'Eksport',
  navCatalogs: 'Kataloglar',
  navClients: 'Mijozlar',

  clientLabel: 'Mijoz',
  clientsTitle: 'Mijozlar',
  clientsHint: 'Har bir mijozning kataloglari, hisobotlari va tarixi alohida saqlanadi.',
  clientsName: 'Mijoz',
  clientsLastAudit: 'Oxirgi tahlil',
  clientsTrend: 'Riskli qatorlar (oxirgi 5 tahlil)',
  clientsMarking: 'Markirovka',
  clientsLastNotice: 'Oxirgi xabarnoma',
  clientsNever: 'hali yoʻq',
  clientsAdd: 'Mijoz qoʻshish',
  clientsNewName: 'Mijoz nomi, masalan: “Baraka Savdo” MChJ',
  clientsCreate: 'Qoʻshish',
  clientsDefault: 'asosiy',
  clientsOpen: 'Ochish',
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
  notificationsNav: 'Xabarnomalar',
  notificationsTitle: 'Xabarnomalar',
  notificationsHint: 'Tasniflagich yangilanganda mijozlaringiz kataloglarida nima oʻzgargani shu yerda koʻrinadi. Telegram ulangan boʻlsa, u yerga ham yuboriladi.',
  notificationsEmpty: 'Hali xabarnoma yoʻq.',
  notificationsOpen: 'Hisobotni ochish',

  catalogsTitle: 'Yuklangan kataloglar',
  catalogsHint: 'Har qanday katalogning hisoboti, koʻrib chiqilishi va eksporti saqlanadi. Katalogni oʻchirsangiz, undan olingan barcha maʼlumotlar ham oʻchiriladi.',
  catalogsEmpty: 'Hali katalog yuklanmagan.',
  catalogsFile: 'Fayl',
  catalogsDate: 'Sana',
  catalogsRows: 'Qatorlar',
  catalogsRisky: 'Riskli',
  catalogsStatus: 'Holat',
  catalogsOpen: 'Ochish',
  catalogsDelete: 'Oʻchirish',
  catalogsDeleteConfirm: (filename) =>
    `“${filename}” katalogi butunlay oʻchiriladi: qatorlar, takliflar va qarorlar tarixi bilan birga. Buni qaytarib boʻlmaydi. Davom etasizmi?`,
  catalogsDeleted: (rows) => `Katalog oʻchirildi (${rows.toLocaleString('uz-UZ')} qator).`,
  catalogStatus: { uploaded: 'Yuklangan', analyzing: 'Tahlil qilinmoqda', ready: 'Tayyor', failed: 'Xatolik' },
  catalogSwitch: 'Katalog',
  catalogAnalyzing: (done, total) =>
    `Tahlil qilinmoqda: ${done.toLocaleString('uz-UZ')} / ${total.toLocaleString('uz-UZ')} qator`,
  catalogAnalyzingHint: 'Sahifa oʻzi yangilanadi. Katta katalog bir necha daqiqa olishi mumkin; sahifani yopsangiz ham tahlil davom etadi.',
  catalogNotAudited: 'Bu katalog hali tahlil qilinmagan: ustunlar moslashtirilishi tasdiqlanmagan.',
  catalogFailed: 'Tahlil xatolik bilan toʻxtadi.',
  catalogRetry: 'Qayta tahlil qilish',
  exportNotReady: 'Tahlil tugagach, faylni eksport qilish mumkin boʻladi.',

  reviewUndo: 'Bekor qilish',
  reviewUndoLast: 'Oxirgi qarorni bekor qilish',
  reviewUndoFailed: 'Bekor qilib boʻlmadi: bu qaror allaqachon bekor qilingan.',
  reviewHistory: 'Qarorlar tarixi',
  reviewHistoryEmpty: 'Hali qaror qabul qilinmagan.',
  historyAccepted: 'Qabul qilindi',
  historyRejected: 'Rad etildi',
  historyBulk: (n) => `${n} ta taklif birdaniga qabul qilindi`,
  historyUndone: (n) => (n > 1 ? `${n} ta qaror bekor qilindi` : 'Qaror bekor qilindi'),

  adminTitle: 'Koʻrsatkichlar',
  adminHint: 'Faqat haqiqiy mijozlar hisoblanadi: demo nusxalar, demo shabloni va ichki (namuna, sinov) tashkilotlar kiritilmagan.',
  adminOrgs: 'Mijoz tashkilotlar',
  adminCatalogs: 'Yuklangan kataloglar',
  adminRowsAudited: 'Tahlil qilingan qatorlar',
  adminRiskyRows: 'Riskli qatorlar',
  adminLast30: (n) => `oxirgi 30 kunda: ${n.toLocaleString('uz-UZ')}`,
  adminByType: 'Topilmalar turi boʻyicha',
  adminDecisions: 'Takliflar boʻyicha qarorlar',
  adminAccepted: 'Qabul qilindi (taklif etilgan kod)',
  adminEdited: 'Qabul qilindi (boshqa kod tanlandi)',
  adminRejected: 'Rad etildi',
  adminPending: 'Koʻrib chiqilmagan',
  adminBulk: 'Birdaniga qabul qilingan qatorlar',
  adminUndone: 'Bekor qilingan qarorlar',
  adminReviewTime: 'Bir qatorni koʻrib chiqish vaqti (mediana)',
  adminReviewValue: (s) => (s === null ? 'hali maʼlumot yoʻq' : `${s.toLocaleString('uz-UZ')} soniya`),
  adminReviewNote: (n) => `${n.toLocaleString('uz-UZ')} ta oraliq asosida; 10 daqiqadan uzun tanaffuslar hisobga olinmaydi.`,
  adminDemo: 'Demo sessiyalar',
  adminLeads: 'Bepul audit soʻrovlari',
  adminLeadsFiles: (n) => `fayl bilan: ${n.toLocaleString('uz-UZ')}`,
  adminGenerated: 'Hisoblangan vaqt',
  adminPipeline: 'Taklif tizimi holati (faqat administratorga koʻrinadi)',

  demoTitle: 'Demoni sinab koʻrish',
  demoIntro: 'Roʻyxatdan oʻtmasdan, namuna katalog ustida dasturning toʻliq ishini koʻring: risk hisoboti, takliflarni koʻrib chiqish va tuzatilgan faylni yuklab olish.',
  demoPoints: [
    'Katalog oʻylab topilgan: real kompaniya maʼlumotlari ishlatilmagan.',
    'Har bir tashrif oʻz nusxasini oladi — qarorlaringizni boshqalar koʻrmaydi.',
    'Demo rejimida fayl yuklash oʻchirilgan.',
  ],
  demoStart: 'Demoni boshlash',
  demoUnavailable: 'Demo hozircha tayyor emas. Birozdan soʻng qayta urinib koʻring.',
  demoBadge: 'Demo',
  demoBanner: (hours) => `Demo rejimi: namuna katalog. Ushbu nusxa ${hours} soatdan soʻng oʻchiriladi.`,
  demoUploadDisabled: 'Demo rejimida fayl yuklash oʻchirilgan. Oʻz katalogingizni tekshirish uchun bosh sahifadagi forma orqali yuboring.',

  uploadTitle: 'Katalogni yuklash',
  uploadHint: 'Excel (.xlsx) yoki CSV fayl. Birinchi qator — sarlavhalar.',
  uploadDrop: 'Faylni shu yerga tashlang',
  uploadChoose: 'yoki fayl tanlang',
  uploadMapTitle: 'Ustunlarni moslashtirish',
  uploadMapHint: 'Faylingizdagi ustunlar qaysi maydonga tegishli ekanini koʻrsating.',
  uploadPreviewTitle: 'Dastlabki 5 qator',
  uploadColumnName: 'Tovar nomi',
  uploadColumnBarcode: 'Shtrix kod',
  uploadColumnMxik: 'MXIK kodi',
  uploadColumnUnit: 'Oʻlchov birligi',
  uploadColumnPrice: 'Narx',
  uploadColumnIgnore: '— hisobga olinmaydi —',
  uploadRequiredName: 'Tovar nomi ustunini koʻrsatish shart.',
  uploadStart: 'Tahlilni boshlash',
  uploadAnalyzing: 'Tahlil qilinmoqda…',
  uploadRowsFound: (n) => `${n.toLocaleString('uz-UZ')} qator topildi`,
  uploadRemembered: 'Oldingi yuklashdagi moslashtirish saqlangan.',

  reportTitle: 'Risk hisoboti',
  reportHeadline: (risky, total) =>
    `${total.toLocaleString('uz-UZ')} pozitsiyadan ${risky.toLocaleString('uz-UZ')} tasi riskli`,
  reportClean: (total) =>
    `${total.toLocaleString('uz-UZ')} pozitsiyaning barchasi tekshiruvdan oʻtdi`,
  reportBreakdownMissing: (n) => `${n} — kod yoʻq`,
  reportBreakdownNotFound: (n) => `${n} — kod bazada topilmadi`,
  reportBreakdownMismatch: (n) => `${n} — nomga mos emas`,
  reportBreakdownUnit: (n) => `${n} — oʻlchov birligi notoʻgʻri`,
  reportFilterAll: 'Barchasi',
  reportFilterType: 'Turi',
  reportFilterSeverity: 'Muhimligi',
  reportPrint: 'Chop etish',
  reportGoReview: 'Koʻrib chiqishga oʻtish',
  reportEmpty: 'Hech qanday risk topilmadi.',

  typeMissing: 'Kod yoʻq',
  typeNotFound: 'Bazada topilmadi',
  typeMismatch: 'Nomga mos emas',
  typeUnitConflict: 'Oʻlchov birligi',
  severityHigh: 'Yuqori',
  severityMedium: 'Oʻrta',

  reviewTitle: 'Koʻrib chiqish',
  reviewProduct: 'Tovar',
  reviewCurrentCode: 'Hozirgi kod',
  reviewSuggested: 'Taklif etilgan kod',
  reviewAlternatives: 'Boshqa variantlar',
  reviewNoCode: 'kod yoʻq',
  reviewAccept: 'Qabul qilish',
  reviewReject: 'Rad etish',
  reviewPickOther: 'Boshqasini tanlash',
  reviewAcceptAllAbove: 'Barcha “Aniq” takliflarni qabul qilish',
  reviewDecided: 'Hal qilindi',
  reviewPending: 'Kutilmoqda',
  reviewAccepted: 'Qabul qilindi',
  reviewRejected: 'Rad etildi',
  reviewKeyboardHint: 'j / k — harakat · Enter — qabul · r — rad etish · u — oxirgisini bekor qilish',
  reviewBoundUnit: 'Biriktirilgan oʻlchov birligi',
  reviewHierarchy: 'Tasniflagichdagi oʻrni',
  reviewConfidence: 'Ishonch',
  reviewProgress: (done, total) => `${done} / ${total} hal qilindi`,
  reviewNothingToReview: 'Koʻrib chiqish uchun pozitsiya qolmadi.',
  markingBadge: 'Markirovka talab qilinadi',
  markingTooltip: (which) => `Tasniflagich maʼlumotida ${which} raqamli markirovka belgisi bilan belgilangan (tasnif.soliq.uz, label = 1).`,
  markingCurrent: 'hozirgi kod',
  markingSuggested: 'taklif etilgan kod',
  markingSummary: (total, risky) => `${total.toLocaleString('uz-UZ')} ta pozitsiya kodi markirovka talab qiladi (shundan ${risky.toLocaleString('uz-UZ')} tasi riskli)`,
  markingFilter: 'Markirovka',
  groupTitle: (n) => `Oʻxshash tovarlar: ${n} ta qator`,
  groupShow: 'Qatorlarni koʻrsatish',
  groupHide: 'Qatorlarni yashirish',
  groupCurrentMixed: 'har bir qatorda oʻzi',
  groupAccept: (n) => `${n} ta qatorni qabul qilish`,
  groupReject: (n) => `${n} ta qatorni rad etish`,
  groupDecided: (accepted, rejected) => `${accepted} qabul qilindi · ${rejected} rad etildi`,
  groupSplit: 'Guruhdan ajratish',
  groupCount: (n) => `${n} ta guruh`,

  exportTitle: 'Eksport',
  exportHint: 'Fayl asl tuzilishida qaytariladi, qabul qilingan kodlar qoʻyilgan holda.',
  exportSummary: (accepted, rejected, pending) =>
    `${accepted} qabul qilindi · ${rejected} rad etildi · ${pending} kutilmoqda`,
  exportDownload: 'Faylni yuklab olish',
  exportStatusColumn: 'audit_status',
  exportStatusAccepted: 'qabul_qilindi',
  exportStatusRejected: 'rad_etildi',
  exportStatusPending: 'korib_chiqilmagan',
  exportStatusOk: 'risk_yoq',

  loading: 'Yuklanmoqda…',
  errorGeneric: 'Xatolik yuz berdi. Qaytadan urinib koʻring.',
  back: 'Orqaga',
  rows: 'qator',
  code: 'Kod',
  confidenceSure: 'Aniq',
  confidenceLikely: 'Ehtimoliy',
  confidenceCheck: 'Tekshirish kerak',
  confidenceDetail: (percent) => `Moslik bahosi: ${percent}%`,

  codeArchived: 'Tasniflagichda arxivlangan',
  codeUnknown: 'Tasniflagichda topilmadi',
  badgeBarcode: 'Shtrix-kod boʻyicha',
  whyTitle: 'Nega bu kod?',
  whyBarcode: 'Qatordagi shtrix-kod tasniflagichda aynan shu kodga biriktirilgan.',
  whyExact: 'Tovar nomi tasniflagichdagi nom bilan bir xil (yozilish farqlari hisobga olinmagan).',
  whyWords: (words) => `Nomdagi mos soʻzlar: ${words.join(', ')}.`,
  whyNoWords: 'Tovar nomi va kod nomida umumiy soʻz yoʻq.',
  whyUnitMatch: (unit) => `Oʻlchov birligi mos: ${unit}.`,
  whyUnitConflict: (rowUnit, codeUnit) => `Oʻlchov birligi mos emas: qatorda “${rowUnit}”, kod talab qiladi “${codeUnit}”.`,
  whyUnitUnknown: 'Oʻlchov birligini solishtirib boʻlmadi.',
  whyUnitNone: 'Kodga qatʼiy oʻlchov birligi biriktirilmagan.',
  whyRerank: (reason) => `Tahlil: ${reason}`,
  whyRerankNone: 'Tahlil: topilgan kodlarning hech biri bu tovarga mos kelmadi.',
  whyScore: (percent) => `Moslik bahosi: ${percent}%.`,
  exportPreviewTitle: 'Faylda oʻzgaradigan qatorlar',
  exportPreviewEmpty: 'Hali birorta taklif qabul qilinmagan — fayl asl holicha qaytadi.',
  exportPreviewMore: (n) => `yana ${n.toLocaleString('uz-UZ')} ta qator`,
  exportBefore: 'Hozirgi kod',
  exportAfter: 'Yangi kod',
};

const DICTS: Record<Locale, Dict> = { uz };

export function dict(locale: Locale = 'uz'): Dict {
  return DICTS[locale];
}

/** The one place UI text is read from, so a locale switch is a one-line change. */
export const t: Dict = uz;
