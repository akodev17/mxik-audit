// Every endpoint, by module: `endpoints.catalogs.previewUpload`. The Nest controllers (W2) and
// @tasnivo/api-client import the same definitions.
import type { Endpoint, ModuleName } from './endpoint';
import { account } from './modules/account';
import { admin } from './modules/admin';
import { auth } from './modules/auth';
import { bank } from './modules/bank';
import { billing } from './modules/billing';
import { catalogs } from './modules/catalogs';
import { clients } from './modules/clients';
import { cron } from './modules/cron';
import { demo } from './modules/demo';
import { didox } from './modules/didox';
import { dictionary } from './modules/dictionary';
import { health } from './modules/health';
import { imports } from './modules/imports';
import { notifications } from './modules/notifications';
import { onec } from './modules/onec';
import { products } from './modules/products';
import { publicApi } from './modules/public-api';
import { reminders } from './modules/reminders';
import { share } from './modules/share';
import { team } from './modules/team';
import { workspace } from './modules/workspace';

export const endpoints = {
  auth, account, clients, catalogs, workspace, dictionary, imports, team, reminders,
  notifications, billing, demo, publicApi, admin, share, cron, health,
  onec, bank, didox, products,
} as const satisfies Record<ModuleName, Record<string, Endpoint>>;

export type Endpoints = typeof endpoints;

/** Every endpoint, module by module in registry order. */
export function allEndpoints(): Endpoint[] {
  return Object.values(endpoints).flatMap((module) => Object.values(module) as Endpoint[]);
}

/** The endpoint with this operation id, or undefined. */
export function byOperationId(operationId: string): Endpoint | undefined {
  return allEndpoints().find((e) => e.operationId === operationId);
}
