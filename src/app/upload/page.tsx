import { redirect } from 'next/navigation';
import { Header, Shell } from '@/components/chrome';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { UploadForm } from './upload-form';

export default async function UploadPage() {
  const user = await currentUser();
  if (!user) redirect('/sign-in');

  const org = await db.organization.findUnique({
    where: { id: user.orgId },
    select: { columnMap: true },
  });

  return (
    <>
      <Header email={user.email} current="/upload" />
      <Shell>
        <UploadForm hadPreviousMapping={org?.columnMap !== null} />
      </Shell>
    </>
  );
}
