// What the signed-in frame shows on every page: the user's visible clients and the active one, the
// unread count and the plan's warnings (GET /api/shell; the web layout read this itself before).
import { canWrite, isAdminRole } from './access';
import { resolveVisibleClient, visibleClients } from './active-client';
import type { LimitKey } from './billing/limits';
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

/**
 * Read-only (Q4/Q15): the default client is created with the org (sign-up, Google, Telegram; the
 * 20261105000100 migration backfilled older orgs; uploads create it if still missing), not by this GET.
 */
export async function shellFrame(user: CurrentUser): Promise<ShellFrame> {
  const [active, clients, unread, plan] = await Promise.all([
    resolveVisibleClient(user),
    visibleClients(user),
    unreadCount(user).catch(() => null),
    planStatus(user.orgId),
  ]);
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
