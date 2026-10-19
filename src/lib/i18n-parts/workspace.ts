// Catalogue workspace: grid, drawer, decisions, bulk actions, keyboard.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  wsX: {
    _area: 'workspace',
  },
};

export const ru: typeof uz = {
  wsX: {
    _area: 'workspace',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
