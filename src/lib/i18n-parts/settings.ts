// Settings tabs, plans and billing, API keys and docs, help links.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  setX: {
    _area: 'settings',
  },
};

export const ru: typeof uz = {
  setX: {
    _area: 'settings',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
