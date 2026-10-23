import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { IconBook } from '@/ui/icons';

/**
 * What the dictionary is and what automatic acceptance does, in two sentences beside the search;
 * an admin, who owns the setting, gets the way to it.
 */
export async function DictionaryExplainer({ admin }: { admin: boolean }) {
  const { ta } = await getI18n();
  const u = ta.wsUi.dict;
  return (
    <aside className="rounded-lg border border-line bg-surface p-4 lg:order-2 lg:row-span-2">
      <h2 className="flex items-center gap-2 text-small font-semibold text-fg"><IconBook size={16} className="text-muted" />{u.autoTitle}</h2>
      <p className="mt-2 text-small text-muted">{u.autoBody}</p>
      <p className="mt-2 text-small text-muted">{u.autoSetting}</p>
      {admin ? <Link href="/settings" className="mt-3 inline-block text-small font-medium text-brand-ink hover:underline">{u.autoLink}</Link> : null}
    </aside>
  );
}
