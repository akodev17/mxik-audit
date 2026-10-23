// UI refresh (U1): strings of the primitives added in the refresh (uiX) and of the auth layout and
// pages (authX). Uzbek Latin first; the Russian object must have the same shape (the type enforces it).

export const uz = {
  uiX: {
    _area: 'ui',
    showPassword: 'Parolni koʻrsatish',
    hidePassword: 'Parolni yashirish',
    loading: 'Yuklanmoqda',
  },
  authX: {
    _area: 'auth',
    home: 'Tasnivo bosh sahifasi',
    footer: { offer: 'Ommaviy oferta', privacy: 'Maxfiylik', help: 'Yordam' },
    brand: {
      promise: 'MXIK kodlaridagi xatolarni soliq tekshiruvidan oldin toping',
      lead: 'Tasnivo katalogingizdagi har bir qatorni MXIK klassifikatori bilan solishtiradi va toʻgʻri kodni taklif qiladi.',
      proofs: [
        'Excel faylni yuklang — natija bir necha daqiqada',
        'Har bir taklif sababi bilan: koʻrib chiqing va bir bosishda tasdiqlang',
        'Mijozlar, jamoa va hisobotlar bir joyda',
      ],
      preview: {
        label: 'Tasnivo oynasidan namuna',
        title: 'Katalog tekshiruvi',
        risky: 'xavfli qator',
        rows: ['Sut 3,2% 1 l', 'Oq non 500 g', 'Shampun 400 ml', 'Yashil choy 100 g'],
        accepted: 'Tasdiqlandi',
        high: 'Yuqori moslik',
        wrong: 'Kod notoʻgʻri',
      },
    },
    signIn: {
      title: 'Hisobingizga kiring',
      lead: 'Davom etish uchun elektron pochta va parolni kiriting.',
      or: 'yoki',
      telegram: 'Telegram orqali kirish',
      rateLimited: 'Kirish vaqtincha toʻxtatildi',
      resetInstead: 'Parolni tiklash',
    },
    twoFactor: {
      digit: (n: number, total: number) => `${total} xonali kodning ${n}-raqami`,
      useRecovery: 'Zaxira koddan foydalanish',
      useApp: 'Ilovadagi 6 xonali kodni kiritish',
      recoveryLabel: 'Zaxira kod',
      recoveryHint: 'Ikki bosqichli himoyani yoqqanda saqlab qoʻygan kodlaringizdan biri.',
      back: 'Boshqa hisob bilan kirish',
    },
    forgot: {
      sentTitle: 'Pochtangizni tekshiring',
      sentTo: (email: string) => `Agar ${email} bilan hisob boʻlsa, unga parolni yangilash havolasi yuborildi. Havola 1 soat amal qiladi.`,
      spam: 'Xat kelmasa, “Spam” jildini tekshiring.',
      again: 'Boshqa manzilni kiritish',
    },
    reset: {
      lead: (email: string) => `${email} hisobi uchun yangi parol oʻrnating.`,
    },
    signUp: {
      lead: 'Bir daqiqada hisob oching va birinchi katalogni tekshiring.',
      trialTitle: '14 kun bepul',
      trialBody: 'Barcha imkoniyatlar ochiq. Karta kerak emas.',
      firmHint: 'Hisobotlarda va jamoa takliflarida koʻrinadi.',
      checkTitle: 'Pochtangizni tasdiqlang',
      strength: { label: 'Parol kuchi', weak: 'Kuchsiz', fair: 'Oʻrtacha', good: 'Yaxshi', strong: 'Kuchli' },
      strengthTip: 'Harflar, raqamlar va belgilarni aralashtiring.',
    },
    invite: {
      title: 'Jamoaga qoʻshiling',
    },
    demo: {
      back: 'Bosh sahifaga',
    },
    closed: {
      lead: 'Hisob yopilgan. Maʼlumotlar belgilangan sanagacha saqlanadi.',
    },
  },
};

export const ru: typeof uz = {
  uiX: {
    _area: 'ui',
    showPassword: 'Показать пароль',
    hidePassword: 'Скрыть пароль',
    loading: 'Загрузка',
  },
  authX: {
    _area: 'auth',
    home: 'Главная страница Tasnivo',
    footer: { offer: 'Публичная оферта', privacy: 'Конфиденциальность', help: 'Помощь' },
    brand: {
      promise: 'Находите ошибки в кодах ИКПУ до налоговой проверки',
      lead: 'Tasnivo сверяет каждую строку вашего каталога с классификатором ИКПУ и предлагает верный код.',
      proofs: [
        'Загрузите Excel — результат через несколько минут',
        'Каждое предложение с обоснованием: проверьте и примите в один клик',
        'Клиенты, команда и отчёты в одном месте',
      ],
      preview: {
        label: 'Пример экрана Tasnivo',
        title: 'Проверка каталога',
        risky: 'рискованная строка',
        rows: ['Молоко 3,2% 1 л', 'Хлеб белый 500 г', 'Шампунь 400 мл', 'Зелёный чай 100 г'],
        accepted: 'Принято',
        high: 'Высокое совпадение',
        wrong: 'Неверный код',
      },
    },
    signIn: {
      title: 'Вход в аккаунт',
      lead: 'Введите электронную почту и пароль, чтобы продолжить.',
      or: 'или',
      telegram: 'Войти через Telegram',
      rateLimited: 'Вход временно приостановлен',
      resetInstead: 'Сбросить пароль',
    },
    twoFactor: {
      digit: (n: number, total: number) => `Цифра ${n} из ${total}`,
      useRecovery: 'Использовать резервный код',
      useApp: 'Ввести 6-значный код из приложения',
      recoveryLabel: 'Резервный код',
      recoveryHint: 'Один из кодов, которые вы сохранили при включении двухэтапной защиты.',
      back: 'Войти с другим аккаунтом',
    },
    forgot: {
      sentTitle: 'Проверьте почту',
      sentTo: (email: string) => `Если аккаунт с адресом ${email} существует, на него отправлена ссылка для смены пароля. Ссылка действует 1 час.`,
      spam: 'Если письма нет, проверьте папку «Спам».',
      again: 'Ввести другой адрес',
    },
    reset: {
      lead: (email: string) => `Задайте новый пароль для аккаунта ${email}.`,
    },
    signUp: {
      lead: 'Откройте аккаунт за минуту и проверьте первый каталог.',
      trialTitle: '14 дней бесплатно',
      trialBody: 'Все возможности открыты. Карта не нужна.',
      firmHint: 'Видно в отчётах и приглашениях в команду.',
      checkTitle: 'Подтвердите почту',
      strength: { label: 'Надёжность пароля', weak: 'Слабый', fair: 'Средний', good: 'Хороший', strong: 'Надёжный' },
      strengthTip: 'Сочетайте буквы, цифры и символы.',
    },
    invite: {
      title: 'Присоединяйтесь к команде',
    },
    demo: {
      back: 'На главную',
    },
    closed: {
      lead: 'Аккаунт закрыт. Данные хранятся до указанной даты.',
    },
  },
};
