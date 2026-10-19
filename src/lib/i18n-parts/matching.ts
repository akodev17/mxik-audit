// Matching explanations: evidence, provenance, AI disclosure, pipeline status.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  matchX: {
    _area: 'matching',
    /** Labels for suggestions whose code came from an identity, not a score. */
    label: {
      barcode: 'Shtrix-kod boʻyicha',
      dictionary: 'Firma lugʻatidan',
    },
    scoreHint: 'Moslik bahosi taklif tovar nomi va tasniflagich bilan qanchalik mos kelishini koʻrsatadi. Bu ehtimollik emas.',
    ai: {
      label: 'AI tahlili',
      note: 'Bu matnni mashina yozgan. Qabul qilishdan oldin tekshiring.',
    },
    dictionary: {
      bulkOnly: 'Firmangiz bu kodni avval faqat ommaviy qabul qilgan, alohida tasdiqlamagan.',
      legacy: 'Kod firma lugʻatidan olingan.',
      conflict: (code: string) => `Firma lugʻatida bu nom uchun boshqa kod bor: ${code}. Shtrix-kod boʻyicha topilgan kod qoldirildi.`,
    },
    rulesLabel: 'Qoida',
    rules: {
      baseCodePreferred: 'Bazaviy kod (…000000): aniq mos kod boʻlmaganda amaliyotda shu tanlanadi.',
      identifyingMarked: 'Identifikatsiya kodi, toifa raqamli markirovkalanadi: bunday kod oʻrinli.',
      identifyingUnmarked: 'Identifikatsiya kodi, lekin toifa markirovkalanmaydi: odatda bazaviy kod xavfsizroq.',
      identifyingUnknownMarking: 'Identifikatsiya kodi; tasniflagich toifa markirovkalanishini koʻrsatmaydi.',
      preparedDishBase: 'Tayyor taom: tasniflagichda batafsil kod yoʻq, umumiy kod mos.',
      preparedDishSpecific: 'Tayyor taom batafsil kodga moslangan, tasniflagich esa bunday kodlarni bermaydi.',
      strictUnitConflict: 'Qatordagi oʻlchov birligi kodga qatʼiy biriktirilgan birlikka mos emas.',
    },
    degraded: {
      title: 'Bu tahlil cheklangan rejimda bajarildi',
      rerank_off: 'AI tekshiruvi oʻchirilgan edi: nom boʻyicha topilgan takliflar “Yuqori moslik” darajasiga chiqarilmagan.',
      vector_off: 'Maʼno boʻyicha qidiruv ishlamadi: takliflar nom va matn oʻxshashligidan topilgan.',
      vector_not_semantic: 'Maʼno boʻyicha qidiruv oʻrniga soddalashtirilgan matn oʻxshashligi ishlatilgan.',
      rerank_failed: (n: number) => `${n} ta qator uchun AI tekshiruvi javob bermadi; ular AI tekshiruvisiz baholangan.`,
      vector_failed: (n: number) => `${n} ta qatorda maʼno boʻyicha qidiruv xato berdi; ular faqat matn boʻyicha topilgan.`,
      rowsWithoutAi: (n: number) => `${n} ta qator AI tekshiruvisiz baholangan.`,
    },
    decisionSource: {
      manual: 'Qoʻlda',
      group: 'Guruh boʻyicha',
      bulk: 'Ommaviy',
      bulk_sure: 'Ommaviy (yuqori moslik)',
      dictionary: 'Firma lugʻatidan (tugma orqali)',
      dictionary_auto: 'Avtomatik: firma lugʻati',
      carry_over: 'Oldingi versiyadan',
    },
    carriedFrom: (who: string) => `Oldingi versiyada ${who} qaror qilgan.`,
    status: {
      rerankLabel: 'AI qayta tartiblash (6-bosqich)',
      rerankOn: (model: string) => `yoqilgan · ${model}`,
      rerankOff: (reason: string) => `oʻchirilgan · ${reason}`,
      vectorLabel: 'Vektor qidiruv (4-bosqich)',
      vectorOk: (provider: string, _count: number, rows: string) => `${provider} · ${rows} qator`,
      vectorStandIn: (provider: string) => `${provider} · semantik emas (vaqtinchalik oʻrinbosar)`,
      vectorOff: (reason: string) => `oʻchirilgan · ${reason}`,
      lastAuditLabel: 'Oxirgi tahlil',
      lastAuditFull: (date: string) => `${date} · toʻliq rejim`,
      lastAuditDegraded: (date: string, reasons: string) => `${date} · cheklangan: ${reasons}`,
      lastAuditNone: 'hali tahlil yoʻq',
      reasonShort: {
        rerank_off: 'AI oʻchiq',
        vector_off: 'vektor oʻchiq',
        vector_not_semantic: 'vektor semantik emas',
        rerank_failed: 'AI xatolari',
        vector_failed: 'vektor xatolari',
      },
    },
  },
};

export const ru: typeof uz = {
  matchX: {
    _area: 'matching',
    label: {
      barcode: 'По штрихкоду',
      dictionary: 'Из словаря фирмы',
    },
    scoreHint: 'Оценка совпадения показывает, насколько предложение совпадает с названием товара и классификатором. Это не вероятность.',
    ai: {
      label: 'Анализ ИИ',
      note: 'Этот текст написан машиной. Проверьте его, прежде чем принимать.',
    },
    dictionary: {
      bulkOnly: 'Ваша фирма раньше принимала этот код только массово, отдельно не подтверждала.',
      legacy: 'Код взят из словаря фирмы.',
      conflict: (code: string) => `В словаре фирмы для этого названия другой код: ${code}. Оставлен код, найденный по штрихкоду.`,
    },
    rulesLabel: 'Правило',
    rules: {
      baseCodePreferred: 'Базовый код (…000000): на практике выбирается, когда точного кода нет.',
      identifyingMarked: 'Идентификационный код, категория подлежит цифровой маркировке: такой код уместен.',
      identifyingUnmarked: 'Идентификационный код, но категория не маркируется: обычно надёжнее базовый код.',
      identifyingUnknownMarking: 'Идентификационный код; классификатор не указывает, маркируется ли категория.',
      preparedDishBase: 'Готовое блюдо: детального кода в классификаторе нет, подходит общий код.',
      preparedDishSpecific: 'Готовое блюдо сопоставлено с детальным кодом, а классификатор таких кодов не даёт.',
      strictUnitConflict: 'Единица измерения в строке не совпадает с единицей, жёстко привязанной к коду.',
    },
    degraded: {
      title: 'Этот анализ выполнен в ограниченном режиме',
      rerank_off: 'Проверка ИИ была отключена: предложения, найденные по названию, не поднимались до уровня «Высокое совпадение».',
      vector_off: 'Смысловой поиск не работал: предложения найдены по сходству названия и текста.',
      vector_not_semantic: 'Вместо смыслового поиска использовалось упрощённое текстовое сходство.',
      rerank_failed: (n: number) => `Для ${n} ${pluralRu(n, 'строки', 'строк', 'строк')} проверка ИИ не ответила; они оценены без ИИ.`,
      vector_failed: (n: number) => `В ${n} ${pluralRu(n, 'строке', 'строках', 'строках')} смысловой поиск дал сбой; они найдены только по тексту.`,
      rowsWithoutAi: (n: number) => `${n} ${pluralRu(n, 'строка оценена', 'строки оценены', 'строк оценено')} без проверки ИИ.`,
    },
    decisionSource: {
      manual: 'Вручную',
      group: 'Группой',
      bulk: 'Массово',
      bulk_sure: 'Массово (высокое совпадение)',
      dictionary: 'Из словаря фирмы (кнопкой)',
      dictionary_auto: 'Автоматически: словарь фирмы',
      carry_over: 'Из предыдущей версии',
    },
    carriedFrom: (who: string) => `Решение из предыдущей версии, автор: ${who}.`,
    status: {
      rerankLabel: 'Переранжирование ИИ (этап 6)',
      rerankOn: (model: string) => `включено · ${model}`,
      rerankOff: (reason: string) => `выключено · ${reason}`,
      vectorLabel: 'Векторный поиск (этап 4)',
      vectorOk: (provider: string, count: number, rows: string) => `${provider} · ${rows} ${pluralRu(count, 'строка', 'строки', 'строк')}`,
      vectorStandIn: (provider: string) => `${provider} · не смысловой (временная замена)`,
      vectorOff: (reason: string) => `выключен · ${reason}`,
      lastAuditLabel: 'Последний анализ',
      lastAuditFull: (date: string) => `${date} · полный режим`,
      lastAuditDegraded: (date: string, reasons: string) => `${date} · ограничен: ${reasons}`,
      lastAuditNone: 'анализов ещё не было',
      reasonShort: {
        rerank_off: 'ИИ выключен',
        vector_off: 'вектор выключен',
        vector_not_semantic: 'вектор не смысловой',
        rerank_failed: 'сбои ИИ',
        vector_failed: 'сбои вектора',
      },
    },
  },
};
