// What the client's purchase and cheque / sales screens read, as one call each. The API's imports
// module answers with these; the pages (clients/[id]/purchases, imports, imports/[listId]) assemble
// the same data themselves until W3 moves them onto the API. Null = not the user's to see (404).
import { db } from '@tasnivo/db';
import { canSeeClient } from './access.js';
import { StoredAttrs } from './catalog-import.js';
import { ownedClient } from './clients.js';
import { codeDetails } from './code-details.js';
import { DocMapSchema, DOC_KINDS, docCheckStale, guessDocMap, readDocMeta, type DocKind, type DocMap, type GroupDetail } from './docs.js';
import { guessPurchaseMap, PurchaseMapSchema, readListMeta, SAMPLE_ROWS, type PurchaseMap } from './purchases.js';
import type { CurrentUser } from './session.js';

type Viewer = Pick<CurrentUser, 'orgId' | 'clientIds'>;

export type PurchaseListRow = {
  id: string; filename: string; rowCount: number; status: string; createdAt: Date; headers: string[]; map: PurchaseMap;
  /** Rows with a code. */
  codes: number;
  sample: string[][]; totalSeen: number | null; truncated: boolean;
};

const originals = (items: { attrs: unknown }[]): string[][] => items.map((i) => StoredAttrs.safeParse(i.attrs).data?.original ?? []);

/** The client's purchase lists, newest first, with their mapping (stored or guessed) and a sample to resume it. */
export async function purchaseListsPage(user: Viewer, clientId: string) {
  const client = await ownedClient(user.orgId, clientId);
  if (!client || !canSeeClient(user, client.id)) return null;
  const [row, lists] = await Promise.all([
    db.client.findUnique({ where: { id: client.id }, select: { activity: true } }),
    db.purchaseList.findMany({
      where: { orgId: user.orgId, clientId: client.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, filename: true, rowCount: true, status: true, createdAt: true, headers: true, columnMap: true, meta: true },
    }),
  ]);
  const codes = await db.purchaseItem.groupBy({
    by: ['listId'],
    where: { listId: { in: lists.map((l) => l.id) }, mxik: { not: null } },
    _count: { mxik: true },
  });
  const codesBy = new Map(codes.map((c) => [c.listId, c._count.mxik]));
  const rows: PurchaseListRow[] = await Promise.all(lists.map(async (l) => {
    const meta = readListMeta(l.meta);
    const sample = meta?.sample
      ?? originals(await db.purchaseItem.findMany({ where: { listId: l.id }, orderBy: { rowIndex: 'asc' }, take: SAMPLE_ROWS, select: { attrs: true } }));
    return {
      id: l.id, filename: l.filename, rowCount: l.rowCount, status: l.status, createdAt: l.createdAt, headers: l.headers,
      map: PurchaseMapSchema.safeParse(l.columnMap).data ?? guessPurchaseMap(l.headers),
      codes: codesBy.get(l.id) ?? 0, sample, totalSeen: meta?.totalSeen ?? null, truncated: meta?.truncated ?? false,
    };
  }));
  return { client: { id: client.id, name: client.name, activity: row?.activity ?? null }, lists: rows };
}

export type DocListRow = {
  id: string; kind: DocKind; filename: string; rowCount: number; status: string; progressDone: number; progressTotal: number;
  error: string | null; createdAt: Date; headers: string[]; map: DocMap;
  /** The check stopped without a heartbeat. */
  stale: boolean;
  /** First rows, to resume the mapping of a list still waiting for it (uploaded or failed); empty otherwise. */
  sample: string[][];
  totalSeen: number | null;
  truncated: boolean;
};

type DocListRecord = { id: string; kind: string; filename: string; rowCount: number; status: string; progressDone: number; progressTotal: number; error: string | null; createdAt: Date; headers: string[]; columnMap: unknown; meta: unknown };

async function docRow(l: DocListRecord): Promise<DocListRow> {
  const meta = readDocMeta(l.meta);
  const resumable = l.status === 'uploaded' || l.status === 'failed';
  const sample = !resumable ? [] : meta.sample
    ?? originals(await db.docItem.findMany({ where: { listId: l.id }, orderBy: { rowIndex: 'asc' }, take: SAMPLE_ROWS, select: { attrs: true } }));
  return {
    id: l.id, kind: l.kind === 'sales' ? 'sales' : 'cheques', filename: l.filename, rowCount: l.rowCount, status: l.status,
    progressDone: l.progressDone, progressTotal: l.progressTotal, error: l.error, createdAt: l.createdAt, headers: l.headers,
    map: DocMapSchema.safeParse(l.columnMap).data ?? guessDocMap(l.headers),
    stale: docCheckStale(l), sample, totalSeen: meta.totalSeen ?? null, truncated: meta.truncated ?? false,
  };
}

/** The client's 30 newest cheque or sales lists. */
export async function docListsPage(user: Viewer, clientId: string, kind: DocKind) {
  const client = await ownedClient(user.orgId, clientId);
  if (!client || !canSeeClient(user, client.id)) return null;
  const wanted = DOC_KINDS.find((k) => k === kind) ?? 'cheques';
  const lists = await db.docList.findMany({ where: { orgId: user.orgId, clientId: client.id, kind: wanted }, orderBy: { createdAt: 'desc' }, take: 30 });
  return { client: { id: client.id, name: client.name }, lists: await Promise.all(lists.map(docRow)) };
}

export type DocGroupRow = {
  id: string; name: string | null; mxik: string | null; mxikName: string | null; unit: string | null; lines: number;
  quantity: number | null; amount: number | null; issues: string[]; suggestedMxik: string | null; confidence: number | null;
  detail: GroupDetail;
};

/**
 * One checked list (imports/[listId]): its groups, largest amount first, with the classifier names
 * of the codes used and suggested. With `issue`, only the groups that have it.
 */
export async function docReport(user: Viewer, listId: string, issue?: string) {
  const list = await db.docList.findFirst({ where: { id: listId, orgId: user.orgId }, include: { client: { select: { name: true } } } });
  if (!list || !canSeeClient(user, list.clientId)) return null;
  const all = list.status === 'ready'
    ? await db.docGroup.findMany({ where: { listId: list.id }, orderBy: [{ amount: { sort: 'desc', nulls: 'last' } }, { lines: 'desc' }] })
    : [];
  const groups = issue ? all.filter((g) => g.issues.includes(issue)) : all;
  const details = await codeDetails(groups.flatMap((g) => [g.mxik, g.suggestedMxik]));
  const name = (code: string | null): string | null => (code ? details.get(code)?.name ?? null : null);
  const meta = readDocMeta(list.meta);
  return {
    list: {
      ...await docRow(list), clientId: list.clientId, clientName: list.client.name,
      groupsTotal: meta.groupsTotal ?? null, groupsChecked: meta.groupsChecked ?? null, ambiguous: meta.ambiguous ?? 0,
    },
    groups: groups.map((g): DocGroupRow => {
      const detail = g.detail as Partial<GroupDetail> | null;
      return {
        id: g.id, name: g.name, mxik: g.mxik, mxikName: name(g.mxik), unit: g.unit, lines: g.lines,
        quantity: g.quantity === null ? null : Number(g.quantity), amount: g.amount === null ? null : Number(g.amount),
        issues: g.issues, suggestedMxik: g.suggestedMxik, confidence: g.confidence,
        detail: { reasons: detail?.reasons ?? [], alternatives: detail?.alternatives ?? [], catalogMatches: detail?.catalogMatches ?? [] },
      };
    }),
  };
}
