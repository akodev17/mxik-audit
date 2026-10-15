import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { UploadForm } from './upload-form';

export default async function UploadPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const org = await db.organization.findUnique({
    where: { id: user.orgId },
    select: { columnMap: true, kind: true },
  });

  return (
    <>
      <Header email={user.email} current="/upload" demo={user.demo} />
      <Shell demo={user.demo}>
        {org?.kind === 'demo' ? (
          <>
            <h1 className="text-2xl">{t.uploadTitle}</h1>
            <p className="mt-4 max-w-2xl border-l-2 border-risk bg-risk-tint px-4 py-3 text-sm text-ink-soft">
              {t.demoUploadDisabled}
            </p>
          </>
        ) : (
          <UploadForm hadPreviousMapping={org?.columnMap !== null} />
        )}
      </Shell>
    </>
  );
}
