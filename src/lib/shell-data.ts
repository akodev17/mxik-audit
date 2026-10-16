// What the app frame needs on every page: clients, unread count, the latest catalogue.
import { canWrite, clientScope } from './access';
import type { LimitKey } from './billing/limits';
import { db } from './db';
import { planStatus, type PlanState } from './plan';
import { resolveClient } from './clients';
import { unreadCount } from './notifications';
import type { CurrentUser } from './session';

export type ShellData = {
  email: string;
  demo: boolean;
  canWrite: boolean;
  plan: { state: PlanState; daysLeft: number | null; warnings: LimitKey[]; full: LimitKey[] };
  clients: { id: string; name: string }[];
  activeClient: { id: string; name: string };
  unread: number;
  /** The catalogue the search box and the demo land on. */
  latestCatalogId: string | null;
};

export async function shellData(user: CurrentUser): Promise<ShellData> {
  const active = await resolveClient(user.orgId, user.clientId);
  const [clients, unread, latest, plan] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId, ...clientScope(user) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    unreadCount(user.orgId).catch(() => 0),
    db.catalog.findFirst({ where: { orgId: user.orgId, clientId: active.id }, orderBy: { createdAt: 'desc' }, select: { id: true } }),
    planStatus(user.orgId),
  ]);
  return {
    email: user.email,
    demo: user.demo,
    canWrite: canWrite(user),
    plan: { state: plan.state, daysLeft: plan.daysLeft, warnings: plan.warnings, full: plan.full },
    clients,
    activeClient: { id: active.id, name: active.name },
    unread,
    latestCatalogId: latest?.id ?? null,
  };
}
