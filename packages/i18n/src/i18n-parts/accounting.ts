// The accounting workflows' shared copy: the navigation group and the four module entries (1C,
// bank statements, Didox invoices, product catalogue), the record statuses, and the validation
// issue codes of packages/contracts/src/accounting.ts. Module-specific copy lives in the
// module's own part (onec.ts, bank.ts, didox.ts, products.ts). Uzbek Latin first; the Russian
// object must have the same shape (the type enforces it).

export const uz = {
  accountingX: {
    _area: 'accounting',
    nav: {
      group: 'Buxgalteriya',
      bank: 'Bank koʻchirmalari',
      didox: 'Didox hisob-fakturalar',
      products: 'Mahsulotlar katalogi',
      onec: '1C import va tarix',
    },
    status: {
      uploaded: 'Yuklandi',
      parsed: 'Oʻqildi',
      review: 'Koʻrib chiqilmoqda',
      approved: 'Tasdiqlandi',
      exported: '1C ga tayyorlandi',
      failed: 'Xato',
    },
    record: {
      valid: 'Toʻgʻri',
      corrected: 'Tuzatildi',
      suspicious: 'Shubhali',
      unresolved: 'Hal qilinmagan',
      skipped: 'Oʻtkazib yuborildi',
      exported: '1C ga yuborildi',
    },
    placeholder: {
      title: 'Bu boʻlim tayyorlanmoqda',
      hint: 'Bank koʻchirmalari, Didox hisob-fakturalar va mahsulotlar katalogini 1C ga tayyorlash shu yerda boʻladi.',
    },
  },
};

export const ru: typeof uz = {
  accountingX: {
    _area: 'accounting',
    nav: {
      group: 'Бухгалтерия',
      bank: 'Банковские выписки',
      didox: 'Счета-фактуры Didox',
      products: 'Каталог товаров',
      onec: 'Импорт в 1С и история',
    },
    status: {
      uploaded: 'Загружено',
      parsed: 'Прочитано',
      review: 'На проверке',
      approved: 'Подтверждено',
      exported: 'Подготовлено для 1С',
      failed: 'Ошибка',
    },
    record: {
      valid: 'Корректно',
      corrected: 'Исправлено',
      suspicious: 'Сомнительно',
      unresolved: 'Не решено',
      skipped: 'Пропущено',
      exported: 'Передано в 1С',
    },
    placeholder: {
      title: 'Раздел готовится',
      hint: 'Здесь будут банковские выписки, счета-фактуры Didox и каталог товаров, подготовленные для 1С.',
    },
  },
};
