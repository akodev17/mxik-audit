import type { Metadata } from 'next';
import { getI18n } from '@/lib/locale';
import { serverApi } from '@/lib/api/server';
import { AuthTitle } from '@/ui/auth-parts';
import { IconCheck } from '@/ui/icons';
import { DemoForm } from './demo-form';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.demoTitle} — ${t.appName}`, robots: { index: false } };
}

/** Landing CTA target: ask for the demo by e-mail; the link that arrives opens a private copy of the sample catalogue. */
export default async function DemoPage() {
  const [{ t }, config] = await Promise.all([getI18n(), serverApi().demo.config()]);
  return (
    <>
      <AuthTitle title={t.demoTitle} lead={t.demoIntro} className="mb-5" />
      <ul className="mb-8 space-y-2.5">
        {t.demoPoints.map((point) => (
          <li key={point} className="flex items-start gap-3 text-body">
            <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-good-tint text-good-ink"><IconCheck size={14} /></span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <DemoForm linkMinutes={config.linkMinutes} />
    </>
  );
}
