// Product modules the owner can switch at runtime (/admin/features): the one list the API guard, the
// web middleware, the header and the dashboard read. Adding a module is one entry here; the uz/ru copy
// (featuresX.modules in @tasnivo/i18n) is then required by the type in apps/web.
import { z } from 'zod';

export const FEATURE_STATES = ['ENABLED', 'COMING_SOON', 'HIDDEN'] as const;
export type FeatureState = (typeof FEATURE_STATES)[number];

export type FeatureModule = {
  /** Web route prefixes: every page at or below one of them belongs to the module. */
  routes: readonly string[];
  /** API path prefixes; a `*` segment stands for any one path segment. */
  api: readonly string[];
  /** For the code and the docs; the screens show featuresX.modules in the viewer's language. */
  label: string;
  description: string;
};

export const FEATURE_MODULES = {
  mxik_audit: {
    routes: ['/catalogs', '/upload', '/queue', '/dictionary'],
    // Not /api/upload/options (the other modules' pages read it) nor /api/dashboard.
    api: ['/api/catalogs', '/api/catalog-diff', '/api/catalog-report-csv', '/api/report-pdf', '/api/export', '/api/findings', '/api/decisions', '/api/bulk-events', '/api/views', '/api/queue', '/api/dictionary'],
    label: 'MXIK audit',
    description: 'Catalogue upload, MXIK code audit, review queue and the firm dictionary',
  },
  products: {
    routes: ['/products'],
    api: ['/api/products', '/api/catalogs/*/products'],
    label: 'Products',
    description: 'The product catalogue with MXIK codes, imports and exports',
  },
  didox: {
    routes: ['/didox'],
    api: ['/api/didox'],
    label: 'Didox invoices',
    description: 'Didox e-invoices: sync, review and 1C export',
  },
  bank: {
    routes: ['/bank'],
    api: ['/api/bank'],
    label: 'Bank statements',
    description: 'Bank statement upload, rules, reconciliation and 1C export',
  },
  onec: {
    routes: ['/onec'],
    api: ['/api/onec'],
    label: '1C',
    description: '1C connection, import batches, counterparties and export history',
  },
} as const satisfies Record<string, FeatureModule>;

export type ModuleKey = keyof typeof FEATURE_MODULES;
export type ModuleStates = Record<ModuleKey, FeatureState>;

export const MODULE_KEYS = Object.keys(FEATURE_MODULES) as [ModuleKey, ...ModuleKey[]];

export const ModuleKeyOf = z.enum(MODULE_KEYS);
/** Every registry key with its state (GET /api/modules). */
export const ModuleStatesOf = z.object(Object.fromEntries(MODULE_KEYS.map((key) => [key, z.enum(FEATURE_STATES)])) as Record<ModuleKey, z.ZodEnum<[...typeof FEATURE_STATES]>>);

/** Every module ENABLED: what a missing row means. */
export function allEnabled(): ModuleStates {
  return Object.fromEntries(MODULE_KEYS.map((key) => [key, 'ENABLED'])) as ModuleStates;
}

/** Stored rows over the defaults; rows for keys no longer in the registry are ignored. */
export function statesFrom(rows: readonly { key: string; state: FeatureState }[]): ModuleStates {
  const states = allEnabled();
  for (const row of rows) if (row.key in states) states[row.key as ModuleKey] = row.state;
  return states;
}

/** True when `path` is `prefix` or below it; `*` in the prefix matches one segment. */
export function underPrefix(path: string, prefix: string): boolean {
  const want = prefix.split('/');
  const have = (path.split('?')[0] ?? '').split('/');
  if (have.length < want.length) return false;
  return want.every((part, i) => part === '*' ? have[i] !== '' : part === have[i]);
}

/** Modules whose web routes contain `pathname` (a page belongs to one; the list keeps it general). */
export function modulesOfRoute(pathname: string): ModuleKey[] {
  return MODULE_KEYS.filter((key) => FEATURE_MODULES[key].routes.some((prefix) => underPrefix(pathname, prefix)));
}

/** Modules whose API prefixes contain `path` (`/api/catalogs/1/products` is both audit and products). */
export function modulesOfApi(path: string): ModuleKey[] {
  return MODULE_KEYS.filter((key) => FEATURE_MODULES[key].api.some((prefix) => underPrefix(path, prefix)));
}

/** The state that wins when several modules cover a path: HIDDEN over COMING_SOON over ENABLED. */
export function strictest(keys: readonly ModuleKey[], states: ModuleStates): { key: ModuleKey; state: FeatureState } | null {
  let worst: { key: ModuleKey; state: FeatureState } | null = null;
  for (const key of keys) {
    const state = states[key];
    if (!worst || FEATURE_STATES.indexOf(state) > FEATURE_STATES.indexOf(worst.state)) worst = { key, state };
  }
  return worst;
}

/**
 * A value read through `load` at most once per `ttlMs`; a failed read is not kept. `invalidate()`
 * drops it in this process only (others expire on their own).
 */
export function ttlCache<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now): { get: () => Promise<T>; invalidate: () => void } {
  let held: { value: Promise<T>; at: number } | null = null;
  return {
    get() {
      if (held && now() - held.at < ttlMs) return held.value;
      const value = load();
      const entry = { value, at: now() };
      held = entry;
      value.catch(() => { if (held === entry) held = null; });
      return value;
    },
    invalidate() {
      held = null;
    },
  };
}

/** How long a process trusts its copy of the module states. */
export const MODULE_STATES_TTL_MS = 30_000;
