// The firm dictionary as the web (page and server actions) and the API both serve it: the page's
// list, the workspace's accept-all button, edits, and the org's auto-accept setting. Messages come
// back in the user's language, as the actions returned them.
import { i18nFor } from '@tasnivo/i18n/locale';
import type { Locale } from '@tasnivo/i18n/i18n';
import { db } from '@tasnivo/db';
import { isAdminRole } from './access.js';
import { codeDetails } from './code-details.js';
import type { Actor } from './decisions.js';
import { editMapping, mayUseDictionary, removeMapping } from './dictionary.js';
import { acceptDictionaryButton } from './dictionary-button.js';
import { approverEmails, dictionaryCounts, dictionaryWhere, parseDictFilter, retiredEntryCodes, type DictFilter } from './dictionary-review.js';
import type { ManyOutcome } from './workspace-ops.js';
import type { Role } from './session.js';

/** Entries per page of /dictionary. */
export const DICT_PAGE = 100;

export type DictEntry = {
  id: string; kind: string; label: string; unit: string | null; code: string; codeName: string | null;
  uses: number; confirmations: number; source: string | null; stale: boolean; updatedAt: Date; approver: string | null;
};

export type DictionaryPage = {
  rows: DictEntry[];
  counts: Record<DictFilter, number>;
  total: number;
  pageSize: number;
  /** False for a member scoped to some clients: the dictionary holds every client's product names. */
  available: boolean;
  /** The query and filter as read (trimmed, defaulted), for links. */
  q: string;
  filter: DictFilter;
  page: number;
};

const NO_COUNTS: Record<DictFilter, number> = { all: 0, confirmed: 0, unverified: 0, stale: 0 };

/** One page of entries, searched and filtered, most used first. */
export async function dictionaryPage(
  user: { orgId: string; clientIds?: string[] | null },
  params: { q?: string | undefined; f?: string | undefined; page?: string | number | undefined },
  locale: Locale,
): Promise<DictionaryPage> {
  const q = (params.q ?? '').trim().slice(0, 80);
  const page = Math.max(0, Math.floor(Number(params.page) || 0));
  const filter = parseDictFilter(params.f);
  if (!mayUseDictionary(user)) return { rows: [], counts: NO_COUNTS, total: 0, pageSize: DICT_PAGE, available: false, q, filter, page };

  const retired = await retiredEntryCodes(user.orgId);
  const where = dictionaryWhere(user.orgId, filter, retired, q);
  const [counts, total, entries] = await Promise.all([
    dictionaryCounts(user.orgId, q),
    db.firmMapping.count({ where }),
    db.firmMapping.findMany({ where, orderBy: [{ uses: 'desc' }, { updatedAt: 'desc' }], skip: page * DICT_PAGE, take: DICT_PAGE }),
  ]);
  const [details, approvers] = await Promise.all([
    codeDetails(entries.map((e) => e.code), locale),
    approverEmails(user.orgId, entries.map((e) => e.updatedBy ?? e.createdBy)),
  ]);
  const rows: DictEntry[] = entries.map((e) => ({
    id: e.id, kind: e.kind, label: e.label, unit: e.unit, code: e.code, codeName: details.get(e.code)?.name ?? null,
    uses: e.uses, confirmations: e.confirmations, source: e.source,
    approver: approvers.get(e.updatedBy ?? e.createdBy ?? '') ?? null,
    stale: e.staleAt !== null || details.get(e.code)?.live === false, updatedAt: e.updatedAt,
  }));
  return { rows, counts, total, pageSize: DICT_PAGE, available: true, q, filter, page };
}

/** "Accept dictionary matches": every pending suggestion that came from the dictionary, one undoable event. */
export async function acceptDictionaryFor(user: Actor, catalogId: string, locale: Locale): Promise<ManyOutcome> {
  const result = await acceptDictionaryButton(user, catalogId);
  return result.ok ? result : { ok: false, error: i18nFor(locale).t.errorGeneric };
}

export type EditResult = { ok: boolean; error?: string };

const CODE = /^\d{17}$/;

/** Points an entry at another code; only a live classifier code is taken, as one confirmation. */
export async function updateDictionaryEntry(user: Actor, id: string, code: string, locale: Locale): Promise<EditResult> {
  const { t, ta } = i18nFor(locale);
  if (!CODE.test(code)) return { ok: false, error: ta.wsX.dict.codeFormat };
  const result = await editMapping(user, id, code);
  if (!result.ok) return { ok: false, error: result.code === 'not_in_classifier' ? ta.msg.codeNotInClassifier : t.errorGeneric };
  return { ok: true };
}

export async function deleteDictionaryEntry(user: Actor, id: string, locale: Locale): Promise<EditResult> {
  const result = await removeMapping(user, id);
  return result.ok ? { ok: true } : { ok: false, error: i18nFor(locale).t.errorGeneric };
}

/** The org setting that accepts dictionary matches automatically in new audits; admins only. */
export async function setDictionaryAutoAccept(user: { orgId: string; userId: string; role: Role }, on: boolean): Promise<{ ok: boolean }> {
  if (!isAdminRole(user)) return { ok: false };
  await db.organization.update({ where: { id: user.orgId }, data: { dictAutoAccept: on } });
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'dictionary.auto_accept', payload: { on } } });
  return { ok: true };
}
