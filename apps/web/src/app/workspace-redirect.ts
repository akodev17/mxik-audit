// The old /export, /report and /review addresses (merged into the catalogue workspace) land on the
// workspace: the catalogue the link names, else the newest one of the client being worked on.
import { redirect } from 'next/navigation';
import { pageData } from '@/lib/api/page-data';
import { serverApi } from '@/lib/api/server';

export async function redirectToWorkspace(params: { catalog?: string; type?: string; marking?: string }): Promise<never> {
  const query = new URLSearchParams();
  const type = params.marking === '1' ? 'MARKING' : params.type;
  if (type) query.set('type', type);
  const qs = query.toString();
  // The workspace page itself refuses a catalogue that is not the user's to see.
  let id = params.catalog ?? null;
  if (!id) {
    const api = serverApi();
    const { activeClient } = await pageData(api.notifications.shell());
    const { items } = await pageData(api.catalogs.list(activeClient ? { clientId: activeClient.id } : {}));
    id = items[0]?.id ?? null;
  }
  if (!id) redirect('/catalogs');
  redirect(qs ? `/catalogs/${encodeURIComponent(id)}?${qs}` : `/catalogs/${encodeURIComponent(id)}`);
}
