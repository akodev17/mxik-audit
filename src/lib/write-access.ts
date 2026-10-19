// Library-level write check, behind the action guards: a viewer never changes
// data even through a code path that forgot its writer() call. Callers without
// a role are internal (jobs, tests) and trusted.
import type { Role } from './session';

export type RoleCarrier = { role?: Role };

export function mayWrite(actor: RoleCarrier): boolean {
  return actor.role === undefined || actor.role === 'admin' || actor.role === 'accountant';
}
