// App shell: navigation, header, search, command palette, notifications, theme.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  shellX: {
    _area: 'shell',
  },
};

export const ru: typeof uz = {
  shellX: {
    _area: 'shell',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
