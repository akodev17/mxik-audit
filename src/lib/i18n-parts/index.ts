// Per-area dictionaries merged into the app dictionary (ta). Each area owns one file and one top-level key.
import * as shell from './shell';
import * as workspace from './workspace';
import * as firm from './firm';
import * as imports from './imports';
import * as security from './security';
import * as settings from './settings';
import * as matching from './matching';

export const partsUz = {
  ...shell.uz,
  ...workspace.uz,
  ...firm.uz,
  ...imports.uz,
  ...security.uz,
  ...settings.uz,
  ...matching.uz,
};

export const partsRu: typeof partsUz = {
  ...shell.ru,
  ...workspace.ru,
  ...firm.ru,
  ...imports.ru,
  ...security.ru,
  ...settings.ru,
  ...matching.ru,
};
