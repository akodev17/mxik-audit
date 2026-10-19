// App shell: navigation, header, search, command palette, notifications, theme.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  shellX: {
    _area: 'shell',
    // Strings inside the shared primitives in src/ui (design system).
    ui: {
      cancel: 'Bekor qilish',
      copy: 'Nusxa olish',
      copied: 'Nusxa olindi',
      copyFailed: 'Nusxa olinmadi. Matnni belgilab, Ctrl+C ni bosing.',
      loading: 'Yuklanmoqda',
      error: 'Xato',
      breadcrumbs: 'Sahifa yoʻli',
      confirmFailed: 'Bajarilmadi. Qayta urinib koʻring.',
      scope: 'Qamrov',
      affected: (n: string, _count: number) => `${n} ta yozuvga taʼsir qiladi`,
    },
  },
};

export const ru: typeof uz = {
  shellX: {
    _area: 'shell',
    ui: {
      cancel: 'Отмена',
      copy: 'Копировать',
      copied: 'Скопировано',
      copyFailed: 'Не удалось скопировать. Выделите текст и нажмите Ctrl+C.',
      loading: 'Загрузка',
      error: 'Ошибка',
      breadcrumbs: 'Путь к странице',
      confirmFailed: 'Не выполнено. Попробуйте ещё раз.',
      scope: 'Охват',
      affected: (n: string, count: number) => `Затронет ${n} ${pluralRu(count, 'запись', 'записи', 'записей')}`,
    },
  },
};
