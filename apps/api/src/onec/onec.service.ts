// endpoints.onec over @tasnivo/domain/onec: the reader's scope (org and the clients they may open)
// on every batch, the domain's machine refusals worded in the request's language (ta.onecX.errors)
// next to their code, and the stored export files.
import { Injectable } from '@nestjs/common';
import type { accounting } from '@tasnivo/contracts';
import type { UploadedFile } from '@tasnivo/domain/catalog-upload';
import type { FileOut } from '@tasnivo/domain/catalog-exports';
import {
  batchDetail, buildExport, decideMany, decideRecord, exportFile, getConnection, importCounterparties, listBatches, listCounterparties, prepareExport,
  saveConnection, testConnection, transferExport,
} from '@tasnivo/domain/onec/index';
import { visibleBatch, visibleClient, type BatchQuery, type RecordQuery } from '@tasnivo/domain/onec/review';
import type { CurrentUser } from '@tasnivo/domain/session';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError } from '../http/errors';
import { found } from '../http/payload';

type OneCFormat = (typeof accounting.ONEC_FORMATS)[number];
type ExportBody = { format: OneCFormat; recordIds?: string[] };
export type Refused = { ok: false; error: string; code: string };

const reader = (u: CurrentUser) => ({ orgId: u.orgId, clientIds: u.clientIds });
const actor = (u: CurrentUser) => ({ ...reader(u), userId: u.userId });

/** `{ ok: false, error: <words>, code }` from a domain refusal code. */
export function refused(locale: Locale, code: string, extra: Record<string, unknown> = {}): Refused {
  const words = i18nFor(locale).ta.onecX.errors;
  return { ok: false, error: words[code] ?? words['generic'] ?? code, code, ...extra };
}

@Injectable()
export class OnecService {
  batches(user: CurrentUser, query: BatchQuery) {
    return listBatches(reader(user), query);
  }

  async batch(user: CurrentUser, batchId: string, query: RecordQuery) {
    return found(await batchDetail(reader(user), batchId, query));
  }

  /** The batch must be the reader's to see; another org's or another client's is 404 like a missing one. */
  private async ensureVisible(user: CurrentUser, batchId: string): Promise<void> {
    if (!(await visibleBatch(reader(user), batchId))) throw new ApiError(404, 'not_found', 'Not found.');
  }

  async prepare(user: CurrentUser, locale: Locale, batchId: string, body: ExportBody) {
    await this.ensureVisible(user, batchId);
    const result = await prepareExport({ orgId: user.orgId, batchId, format: body.format, recordIds: body.recordIds });
    return result.ok ? result : refused(locale, result.error);
  }

  async exportBatch(user: CurrentUser, locale: Locale, batchId: string, body: ExportBody) {
    await this.ensureVisible(user, batchId);
    const result = await buildExport({ orgId: user.orgId, batchId, format: body.format, recordIds: body.recordIds, actorId: user.userId });
    if (!result.ok) return refused(locale, result.error);
    const disposition = result.file.headers['content-disposition'] ?? '';
    const filename = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1];
    return { ok: true as const, exportId: result.exportId, filename: filename ? decodeURIComponent(filename) : null, reused: result.reused ?? false };
  }

  async transfer(user: CurrentUser, locale: Locale, batchId: string, body: { format: 'odata'; recordIds?: string[] }) {
    await this.ensureVisible(user, batchId);
    const result = await transferExport({ orgId: user.orgId, batchId, format: body.format, recordIds: body.recordIds, actorId: user.userId });
    return result.ok ? result : refused(locale, result.error);
  }

  async exportFile(user: CurrentUser, exportId: string): Promise<FileOut> {
    return found(await exportFile(user.orgId, exportId, user.clientIds));
  }

  async decide(user: CurrentUser, locale: Locale, recordId: string, body: unknown) {
    const result = await decideRecord(actor(user), recordId, body);
    if (!result.ok && result.error === 'not_found') throw new ApiError(404, 'not_found', 'Not found.');
    return result.ok ? result : refused(locale, result.error, result.field ? { field: result.field } : {});
  }

  async decideMany(user: CurrentUser, locale: Locale, batchId: string, body: unknown) {
    const result = await decideMany(actor(user), batchId, body);
    if (!result.ok && result.error === 'not_found') throw new ApiError(404, 'not_found', 'Not found.');
    return result.ok ? result : refused(locale, result.error);
  }

  connection(user: CurrentUser) {
    return getConnection(user.orgId);
  }

  async saveConnection(user: CurrentUser, locale: Locale, body: unknown) {
    const result = await saveConnection(user.orgId, user.userId, body);
    return result.ok ? result : refused(locale, result.error);
  }

  testConnection(user: CurrentUser) {
    return testConnection(user.orgId);
  }

  async counterparties(user: CurrentUser, query: { q?: string; client?: string; page: number }) {
    if (query.client && !(await visibleClient(reader(user), query.client))) throw new ApiError(404, 'not_found', 'Not found.');
    return listCounterparties(user.orgId, { clientIds: user.clientIds, ...(query.client ? { clientId: query.client } : {}) }, query.q, query.page);
  }

  async importCounterparties(user: CurrentUser, locale: Locale, fields: Record<string, unknown>, file: UploadedFile | null) {
    const raw = fields['clientId'];
    const clientId = typeof raw === 'string' && raw.length > 0 && raw.length <= 64 ? raw : null;
    // A scoped accountant loads a client's list; the org-level list is for unrestricted users.
    if (!(await visibleClient(reader(user), clientId))) return refused(locale, 'client');
    if (!file) return refused(locale, 'unreadable');
    let bytes: Buffer;
    try {
      bytes = await file.read();
    } catch {
      return refused(locale, 'unreadable');
    }
    const result = await importCounterparties(user.orgId, clientId, bytes, file.name);
    return result.ok ? result : refused(locale, result.error);
  }
}
