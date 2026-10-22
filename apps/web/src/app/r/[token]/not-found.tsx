import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { buttonClass } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';

/** An unknown, revoked or expired share link: 404, with a quiet way to the site. */
export default async function ShareNotFound() {
  const { ta } = await getI18n();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <EmptyState
        tone="danger" title={ta.share.invalid} hint={ta.share.invalidHint}
        action={<Link href="/" className={buttonClass('ghost', 'sm')}>{ta.setX.pub.toSite}</Link>}
      />
    </main>
  );
}
