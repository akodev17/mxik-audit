import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getI18n } from '@/lib/locale';
import { getModuleStates, isModuleKey } from '@/lib/modules';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

type Props = { params: Promise<{ module: string }> };

/** The module named in the URL when it is COMING_SOON now, else null (the page is then the 404). */
async function soonModule(params: Props['params']) {
  const { module } = await params;
  if (!isModuleKey(module)) return null;
  return (await getModuleStates())[module] === 'COMING_SOON' ? module : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const key = await soonModule(params);
  return { title: `${key ? ta.featuresX.modules[key].label : ta.shellX.notFound.title} — ${t.appName}`, robots: { index: false } };
}

/** What every page of a COMING_SOON module shows (src/middleware.ts rewrites them here); any other state is the 404. */
export default async function ComingSoonPage({ params }: Props) {
  const key = await soonModule(params);
  if (!key) notFound();
  const { ta } = await getI18n();
  const f = ta.featuresX;
  return (
    <Page title={f.modules[key].label} hint={f.modules[key].description}>
      <div className="rounded-lg border border-line bg-raised">
        <EmptyState title={f.soon} hint={f.page.hint} action={<ButtonLink href="/dashboard" variant="primary">{f.page.back}</ButtonLink>} />
      </div>
    </Page>
  );
}
