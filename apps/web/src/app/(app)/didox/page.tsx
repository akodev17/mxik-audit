// Placeholder from the base commit of the accounting programme (docs/TASNIVO_AI_PLAN_2026-10-23.md).
// The owning workstream replaces this page; keeping the route from day one lets the shell, the
// command palette and the tests know the section before its screens land.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { signedIn } from '@/lib/api/me';
import { getI18n } from '@/lib/locale';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';

export async function generateMetadata(): Promise<Metadata> {
  const { t, ta } = await getI18n();
  return { title: `${ta.accountingX.nav.didox} — ${t.appName}` };
}

export default async function DidoxPage() {
  const { ta } = await getI18n();
  const user = await signedIn();
  if (!user) redirect('/sign-in');
  const a = ta.accountingX;
  return (
    <Page title={a.nav.didox} hint={a.placeholder.hint}>
      <EmptyState title={a.placeholder.title} hint={a.placeholder.hint} />
    </Page>
  );
}
