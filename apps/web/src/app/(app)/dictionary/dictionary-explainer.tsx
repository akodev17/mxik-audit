import Link from 'next/link';
import { getI18n } from '@/lib/locale';
import { IconBook } from '@/ui/icons';

/**
 * What the dictionary is and what automatic acceptance does, as one quiet band above the search;
 * an admin, who owns the setting, gets the way to it.
 */
export async function DictionaryExplainer({ admin }: { admin: boolean }) {
  const { ta } = await getI18n();
  const u = ta.wsUi.dict;
  return (
    <aside aria-label={u.autoTitle} className="mb-5 flex gap-3 rounded-lg border border-line bg-surface p-4">
      <IconBook size={18} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 space-y-1 text-small">
        <h2 className="font-semibold text-fg">{u.autoTitle}</h2>
        <p className="text-muted">{u.autoBody} {u.autoSetting}</p>
        {admin ? <Link href="/settings" className="inline-block font-medium text-brand-ink hover:underline">{u.autoLink}</Link> : null}
      </div>
    </aside>
  );
}
