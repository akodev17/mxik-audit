// Module states (GET /api/modules) for the middleware, the frame and the dashboard, through a 30 s
// cache per web process. The states are the same for everyone, so no cookie is sent.
import { createApiClient } from '@tasnivo/api-client';
import { MODULE_KEYS, MODULE_STATES_TTL_MS, ttlCache, type ModuleKey, type ModuleStates } from '@tasnivo/contracts/feature-modules';

const api = createApiClient({ baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000', credentials: 'omit' });
const cache = ttlCache(() => api.account.modules({}, { cache: 'no-store' }), MODULE_STATES_TTL_MS);

export function getModuleStates(): Promise<ModuleStates> {
  return cache.get();
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}
