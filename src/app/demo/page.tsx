import type { Metadata } from 'next';
import Link from 'next/link';
import { t } from '@/lib/i18n';
import { StartDemoButton } from './start-button';

export const metadata: Metadata = {
  title: `${t.demoTitle} — ${t.appName}`,
  robots: { index: false },
};

/** Landing CTA target: one click into a private copy of the sample catalogue. */
export default function DemoPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <Link href="/" className="font-serif text-lg font-semibold tracking-tight">{t.appName}</Link>
      <h1 className="mt-6 text-3xl">{t.demoTitle}</h1>
      <p className="mt-4 text-ink-soft">{t.demoIntro}</p>
      <ul className="mt-6 list-none space-y-2.5 p-0 text-sm text-ink-soft">
        {t.demoPoints.map((point) => (
          <li key={point} className="flex gap-3">
            <span aria-hidden="true" className="text-ok">✓</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <StartDemoButton />
    </main>
  );
}
