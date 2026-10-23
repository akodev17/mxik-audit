// The API's generic refusals (apps/api/src/http/exception.filter.ts): what a form shows when the
// session ended, a record is gone, the request was too big or failed the CSRF check.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).

export const uz = {
  httpX: {
    _area: 'http',
    unauthorized: 'Sessiya tugagan. Qaytadan kiring.',
    notFound: 'Topilmadi yoki sizga ochiq emas.',
    tooLarge: 'Soʻrov juda katta.',
    csrf: 'Soʻrov rad etildi. Sahifani yangilab, qayta urinib koʻring.',
  },
};

export const ru: typeof uz = {
  httpX: {
    _area: 'http',
    unauthorized: 'Сеанс завершён. Войдите снова.',
    notFound: 'Не найдено или нет доступа.',
    tooLarge: 'Слишком большой запрос.',
    csrf: 'Запрос отклонён. Обновите страницу и попробуйте снова.',
  },
};
