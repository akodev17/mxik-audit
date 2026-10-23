import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { serverApi } from '@/lib/api/server';
import { AuthResult, AuthTitle } from '@/ui/auth-parts';
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
  if (!link) {
    return (
      <AuthResult
        tone="danger" role="none" title={d.invalidTitle}
        action={<ButtonLink href="/demo" variant="primary" size="lg" className="w-full">{d.requestNew}</ButtonLink>}
      >
        <p>{d.invalidBody}</p>
      </AuthResult>
    );
  }
  return (
    <>
      <AuthTitle title={d.verifyHello(link.name)} lead={d.verifyBody(config.ttlHours, config.idleMinutes)} />
      <OpenDemoButton token={token} />
    </>
  );
}
