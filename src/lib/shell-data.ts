// What the app frame needs on every page: the user's visible clients, the active one, unread count, plan.
import { canWrite } from './access';
import { resolveVisibleClient, visibleClients, type VisibleClient } from './active-client';
import type { LimitKey } from './billing/limits';
import { defaultClient } from './clients';
import { planStatus, type PlanState } from './plan';
import { unreadCount } from './notifications';
import type { CurrentUser } from './session';

export type ShellData = {
  email: string;
  demo: boolean;
  canWrite: boolean;
  plan: { state: PlanState; daysLeft: number | null; warnings: LimitKey[]; full: LimitKey[] };
  /** Clients this user may switch to; never another scope's. */
  clients: { id: string; name: string }[];
  /** Null when the user has no visible client (a scoped user whose clients are all archived). */
  activeClient: { id: string; name: string } | null;
  /** Null when the count could not be read: the bell then shows no number rather than a wrong one. */
  unread: number | null;
};

/** The active client; an unscoped user in an org without clients gets the default one created, as before. */
async function activeFor(user: CurrentUser): Promise<VisibleClient | null> {
  const found = await resolveVisibleClient(user);
  if (found || user.clientIds != null) return found;
  await defaultClient(user.orgId);
  return resolveVisibleClient(user);
}

export async function shellData(user: CurrentUser): Promise<ShellData> {
  const active = await activeFor(user);
  const [clients, unread, plan] = await Promise.all([
    visibleClients(user),
    unreadCount(user).catch(() => null),
    planStatus(user.orgId),
  ]);
  return {
    email: user.email,
    demo: user.demo,
    canWrite: canWrite(user),
    plan: { state: plan.state, daysLeft: plan.daysLeft, warnings: plan.warnings, full: plan.full },
    clients,
    activeClient: active ? { id: active.id, name: active.name } : null,
    unread,
  };
}
