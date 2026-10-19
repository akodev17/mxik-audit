import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { canWrite, clientScope, isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { uploadsOpen } from '@/lib/plan';
import { currentUser } from '@/lib/session';
import { uploadPreview } from '@/lib/upload-preview';
import { uploadProgress } from '@/lib/upload-progress';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Notice } from './notice';
import { UploadWizard, type WizardStart } from './upload-wizard';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.uploadTitle} — ${t.appName}` };
}

type Search = { client?: string; catalog?: string };

/** Where /upload?catalog=… picks up: the mapping of an uncommitted upload, or its audit. */
async function resume(user: NonNullable<Awaited<ReturnType<typeof currentUser>>>, catalogId: string | undefined): Promise<WizardStart | null> {
  if (!catalogId) return { step: 'select' };
  const preview = await uploadPreview(user, catalogId);
  if (preview) return { step: 'map', preview };
  const progress = await uploadProgress(user, catalogId);
  if (!progress || progress.status === 'uploaded') return null;
  if (progress.status === 'ready') return { step: 'done', catalogId, summary: progress.summary };
  return { step: 'processing', catalogId };
}

export default async function UploadPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { t, ta } = await getI18n();
  const s = ta.importX.select;
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const params = await searchParams;

  const page = (body: ReactNode) => <Page title={t.uploadTitle} hint={t.uploadHint}>{body}</Page>;
  if (user.demo) return page(<EmptyState title={t.demoUploadDisabled} />);
  // A viewer could call the actions directly; they refuse too. Here the screen just says why there is no upload.
  if (!canWrite(user)) return page(<EmptyState title={s.readOnlyTitle} hint={s.readOnlyHint} />);

  const clients = await db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
  if (clients.length === 0) return page(<EmptyState title={s.noClientsTitle} hint={s.noClientsHint} />);

  const open = await uploadsOpen(user.orgId);
  if (!open.ok && !params.catalog) {
    return page(
      <EmptyState
        title={s.expiredTitle} hint={ta.msg.gate.expired}
        action={isAdminRole(user) ? <ButtonLink href="/settings" variant="primary">{s.openSettings}</ButtonLink> : undefined}
      />,
    );
  }

  const start = await resume(user, params.catalog);
  const wanted = params.client ?? user.clientId;
  const active = clients.find((c) => c.id === wanted) ?? clients[0];
  const initialClientId = start?.step === 'map' ? start.preview.client.id : (active?.id ?? '');

  return page(
    <>
      {start === null ? <Notice tone="warn" className="mb-4">{s.resumeMissing}</Notice> : null}
      {/* No key: the wizard rewrites this URL itself and decides which new starts replace its screen. */}
      <UploadWizard
        clients={clients} initialClientId={initialClientId} start={start ?? { step: 'select' }}
      />
    </>,
  );
}
