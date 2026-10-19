// Upload wizard, column mapping, diagnostics, versions, exports, purchases, cheque and sales lists.
// Uzbek Latin first; the Russian object must have the same shape (the type enforces it).
import { pluralRu } from '../plural';

export const uz = {
  importX: {
    _area: 'imports',
  },
};

export const ru: typeof uz = {
  importX: {
    _area: 'imports',
  },
};

// Keeps the import used until the first Russian plural lands in this file.
void pluralRu;
