'use server';

// The upload wizard and catalogue deletion. The rules and messages live in
// @tasnivo/domain/catalog-upload (shared with the API); these add the session and the cache.
import { getLocale } from '@/lib/locale';
import { revalidatePath } from 'next/cache';
import {
  commitCatalogUpload, diagnoseCatalogUpload, formFile, discardCatalogUpload, previewCatalogUpload, removeCatalogFor, retryCatalogAudit as retryFor,
  type CommitResult, type DiagnoseResult, type PreviewResult, type RemoveResult,
} from '@tasnivo/domain/catalog-upload';
import { writer } from '@/lib/guard';
import { getSession } from '@/lib/session';

export type { CommitResult, DiagnoseResult, PreviewResult, RemoveResult };

/**
 * Reads the file once, stores every row as an uncommitted preview and returns
 * what the wizard shows. Changing the mapping later never means re-uploading.
 */
export async function previewUpload(form: FormData): Promise<PreviewResult> {
  const requested = form.get('clientId');
  return previewCatalogUpload(await writer(), await getLocale(), {
    file: formFile(form.get('file')),
    clientId: typeof requested === 'string' && requested ? requested : null,
  });
}

/** Validates a mapping for an uncommitted upload and recomputes its import diagnostics on the server. */
export async function diagnoseUpload(payload: unknown): Promise<DiagnoseResult> {
  return diagnoseCatalogUpload(await writer(), await getLocale(), payload);
}

/** Confirms the mapping and starts the audit; the client just uploaded to becomes the one being worked on. */
export async function commitUpload(payload: unknown): Promise<CommitResult> {
  const user = await writer();
  const { result, clientId } = await commitCatalogUpload(user, await getLocale(), payload);
  if (!result.ok) return result;
  if (clientId && clientId !== user?.clientId) {
    const session = await getSession();
    session.clientId = clientId;
    await session.save();
  }
  revalidatePath('/catalogs');
  revalidatePath('/dashboard');
  revalidatePath(`/clients/${clientId ?? ''}`);
  return result;
}

/** "Start over": deletes an upload that was never committed. */
export async function discardUpload(catalogId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  return discardCatalogUpload(await writer(), await getLocale(), catalogId);
}

/** Restarts an audit that failed. */
export async function retryCatalogAudit(catalogId: unknown): Promise<{ ok: boolean }> {
  const result = await retryFor(await writer(), catalogId);
  revalidatePath('/report');
  return result;
}

/** Deletes one of the org's catalogues and everything derived from it. */
export async function removeCatalog(catalogId: unknown): Promise<RemoveResult> {
  const result = await removeCatalogFor(await writer(), await getLocale(), catalogId);
  if (!result.ok) return result;
  revalidatePath('/catalogs');
  revalidatePath('/report');
  revalidatePath('/review');
  revalidatePath('/export');
  return result;
}
