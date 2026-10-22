// Old report, review and export URLs land on the catalogue workspace.
import { redirect } from 'next/navigation';
import { catalogForPage } from './catalog-page';
import { currentUser } from './session';

export async function redirectToWorkspace(params: { catalog?: string; type?: string; marking?: string }): Promise<never> {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { catalog } = await catalogForPage(user, params.catalog);
  if (!catalog) redirect('/catalogs');
  const query = new URLSearchParams();
  const type = params.marking === '1' ? 'MARKING' : params.type;
  if (type) query.set('type', type);
  const qs = query.toString();
  redirect(qs ? `/catalogs/${catalog.id}?${qs}` : `/catalogs/${catalog.id}`);
}
