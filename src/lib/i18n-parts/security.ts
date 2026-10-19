// Sign-in, password reset, two-factor, sessions, Telegram login, account control.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  secX: {
    _area: 'security',
  },
};

export const ru: typeof uz = {
  secX: {
    _area: 'security',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
