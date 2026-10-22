import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApi } from '@/lib/api/server';
import { ButtonLink } from '@/ui/button';
import { OpenDemoButton } from './open-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  // The link is a secret: never let it be indexed or sent on in a Referer header.
  return { title: `${t.demoAccess.verifyTitle} — ${t.appName}`, robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/**
 * The page behind the e-mailed link. Opening it changes nothing (mail scanners and previews fetch links);
 * the demo opens, and the link is used up, only when the visitor presses the button.
 */
export default async function VerifyDemoPage({ params }: { params: Promise<{ token: string }> }) {
  const { t } = await getI18n();
  const d = t.demoAccess;
  const { token } = await params;
  const usable = token.length >= 20 && token.length <= 100;
  const [link, config] = await Promise.all([usable ? serverApi().demo.peek({ token }) : null, serverApi().demo.config()]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <div className="mt-6 rounded-ctl border border-line bg-base p-6 shadow-pop">
        {link ? (
          <>
            <h1 className="text-xl">{d.verifyHello(link.name)}</h1>
            <p className="mt-2 text-sm text-muted">{d.verifyBody(config.ttlHours, config.idleMinutes)}</p>
            <OpenDemoButton token={token} />
          </>
        ) : (
          <>
            <h1 className="text-xl">{d.invalidTitle}</h1>
            <p className="mt-2 text-sm text-muted">{d.invalidBody}</p>
            <ButtonLink href="/demo" variant="primary" className="mt-6 w-full">{d.requestNew}</ButtonLink>
          </>
        )}
      </div>
    </main>
  );
}
