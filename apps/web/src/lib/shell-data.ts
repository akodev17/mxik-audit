// What the app frame needs on every page: the user's visible clients, the active one, unread count, plan.
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { resolveVisibleClient, visibleClients, type VisibleClient } from '@tasnivo/domain/active-client';
import type { LimitKey } from '@tasnivo/domain/billing/limits';
import { defaultClient } from '@tasnivo/domain/clients';
import { planStatus, type PlanState } from './plan';
import { unreadCount } from '@tasnivo/domain/notifications';
import type { CurrentUser } from './session';

export type ShellData = {
  email: string;
  demo: boolean;
  canWrite: boolean;
  /** Administrator of a real organisation: may open the team page. */
  canManageTeam: boolean;
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
  const [active, listed, unread, plan] = await Promise.all([
    activeFor(user),
    visibleClients(user),
    unreadCount(user).catch(() => null),
    planStatus(user.orgId),
  ]);
  // activeFor may have just created the default client, after the list was read.
  const clients = active && !listed.some((c) => c.id === active.id) ? await visibleClients(user) : listed;
  return {
    email: user.email,
    demo: user.demo,
    canWrite: canWrite(user),
    canManageTeam: isAdminRole(user) && !user.demo,
    plan: { state: plan.state, daysLeft: plan.daysLeft, warnings: plan.warnings, full: plan.full },
    clients,
    activeClient: active ? { id: active.id, name: active.name } : null,
    unread,
  };
}
