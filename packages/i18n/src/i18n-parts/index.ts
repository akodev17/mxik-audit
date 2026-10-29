// Per-area dictionaries merged into the app dictionary (ta). Each area owns one file and one top-level key.
import * as shell from './shell';
import * as workspace from './workspace';
import * as firm from './firm';
import * as imports from './imports';
import * as security from './security';
import * as settings from './settings';
import * as matching from './matching';
import * as auth from './auth';
import * as manage from './manage';
import * as pricing from './pricing';
import * as http from './http';
import * as accounting from './accounting';
import * as onec from './onec';
import * as bank from './bank';
import * as didox from './didox';
import * as products from './products';
import * as tour from './tour';
import * as features from './features';
import * as lexicon from './lexicon';

export const partsUz = {
  ...shell.uz,
  ...workspace.uz,
  ...firm.uz,
  ...imports.uz,
  ...security.uz,
  ...settings.uz,
  ...matching.uz,
  ...auth.uz,
  ...manage.uz,
  ...pricing.uz,
  ...http.uz,
  ...accounting.uz,
  ...onec.uz,
  ...bank.uz,
  ...didox.uz,
  ...products.uz,
  ...tour.uz,
  ...features.uz,
  ...lexicon.uz,
};

export const partsRu: typeof partsUz = {
  ...shell.ru,
  ...workspace.ru,
  ...firm.ru,
  ...imports.ru,
  ...security.ru,
  ...settings.ru,
  ...matching.ru,
  ...auth.ru,
  ...manage.ru,
  ...pricing.ru,
  ...http.ru,
  ...accounting.ru,
  ...onec.ru,
  ...bank.ru,
  ...didox.ru,
  ...products.ru,
  ...tour.ru,
  ...features.ru,
  ...lexicon.ru,
};
