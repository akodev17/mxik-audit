// What the signed-in frame shows on every page: the user's visible clients and the active one, the
// unread count and the plan's warnings (GET /api/shell; the web layout read this itself before).
import { canWrite, isAdminRole } from './access';
import { resolveVisibleClient, visibleClients, type VisibleClient } from './active-client';
import type { LimitKey } from './billing/limits';
import { defaultClient } from './clients';
import { unreadCount } from './notifications';
import { planStatus, type PlanState } from './plan';
import type { CurrentUser } from './session';

export type ShellFrame = {
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

export async function shellFrame(user: CurrentUser): Promise<ShellFrame> {
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
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    activeClient: active ? { id: active.id, name: active.name } : null,
    unread,
  };
}
