// Module states (/admin/features) from feature_flag through a 30 s cache. A save drops the cache of
// this process; other API processes pick it up when theirs expires.
import { db } from '@tasnivo/db';
import {
  MODULE_KEYS, MODULE_STATES_TTL_MS, statesFrom, ttlCache, type FeatureState, type ModuleKey, type ModuleStates,
} from '@tasnivo/contracts/feature-modules';

const cache = ttlCache(async () => statesFrom(await db.featureFlag.findMany({ select: { key: true, state: true } })), MODULE_STATES_TTL_MS);

/** Every registry module with its state; a module without a row is ENABLED. */
export function getModuleStates(): Promise<ModuleStates> {
  return cache.get();
}

/** The admin table: every registry module, its state and when it was last saved (null = never). */
export async function moduleFlagRows(): Promise<{ key: ModuleKey; state: FeatureState; updatedAt: Date | null }[]> {
  const byKey = new Map((await db.featureFlag.findMany()).map((row) => [row.key, row]));
  return MODULE_KEYS.map((key) => ({ key, state: byKey.get(key)?.state ?? 'ENABLED', updatedAt: byKey.get(key)?.updatedAt ?? null }));
}

/** Writes the given states in one transaction and drops this process's cache. */
export async function setModuleStates(states: Partial<ModuleStates>): Promise<void> {
  const entries = Object.entries(states) as [ModuleKey, FeatureState][];
  await db.$transaction(entries.map(([key, state]) => db.featureFlag.upsert({ where: { key }, create: { key, state }, update: { state } })));
  cache.invalidate();
}
