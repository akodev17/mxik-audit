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
  confidenceHigh: string;
  confidenceMedium: string;
  confidenceLow: string;
  degradedNotice: string;
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

  reviewUndo: 'Bekor qilish',
  reviewUndoLast: 'Oxirgi qarorni bekor qilish',
  reviewUndoFailed: 'Bekor qilib boʻlmadi: bu qaror allaqachon bekor qilingan.',
  reviewHistory: 'Qarorlar tarixi',
  reviewHistoryEmpty: 'Hali qaror qabul qilinmagan.',
  historyAccepted: 'Qabul qilindi',
  historyRejected: 'Rad etildi',
  historyBulk: (n) => `${n} ta taklif birdaniga qabul qilindi`,
  historyUndone: (n) => (n > 1 ? `${n} ta qaror bekor qilindi` : 'Qaror bekor qilindi'),

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
  reviewAcceptAllAbove: '90% dan yuqori barchasini qabul qilish',
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
  confidenceHigh: 'Yuqori ishonch',
  confidenceMedium: 'Tekshirish kerak',
  confidenceLow: 'Past ishonch',
  degradedNotice:
    'Diqqat: taklif tizimi toʻliq quvvatda ishlamayapti. Ishonch koʻrsatkichlari pastroq baholangan.',
};

const DICTS: Record<Locale, Dict> = { uz };

export function dict(locale: Locale = 'uz'): Dict {
  return DICTS[locale];
}

/** The one place UI text is read from, so a locale switch is a one-line change. */
export const t: Dict = uz;
