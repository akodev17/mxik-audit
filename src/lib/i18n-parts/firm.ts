// Dashboard, clients, review queue, activity, reminders.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  firmX: {
    _area: 'firm',
  },
};

export const ru: typeof uz = {
  firmX: {
    _area: 'firm',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
