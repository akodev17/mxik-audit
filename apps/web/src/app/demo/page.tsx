import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import Link from 'next/link';
import { demoLinkMinutes } from '@tasnivo/domain/demo-config';
import { DemoForm } from './demo-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.demoTitle} — ${t.appName}`, robots: { index: false } };
}

/** Landing CTA target: ask for the demo by e-mail; the link that arrives opens a private copy of the sample catalogue. */
export default async function DemoPage() {
  const { t } = await getI18n();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <div className="mt-6 rounded-ctl border border-line bg-base p-6 shadow-pop">
        <h1 className="text-xl">{t.demoTitle}</h1>
        <p className="mt-2 text-sm text-muted">{t.demoIntro}</p>
        <ul className="mt-4 list-none space-y-2 p-0 text-sm">
          {t.demoPoints.map((point) => (
            <li key={point} className="flex gap-3">
              <span aria-hidden="true" className="text-good">✓</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <DemoForm linkMinutes={demoLinkMinutes()} />
      </div>
    </main>
  );
}
