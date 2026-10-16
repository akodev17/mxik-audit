'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

export type CatalogOption = { id: string; label: string };

type Props = {
  options: CatalogOption[];
  current: string;
  /** The client whose catalogue this is; shown for firms with several clients. */
  client?: { id: string; name: string; isDefault: boolean };
};

/** Names the client, and lets report, review and export work on any earlier catalogue. */
export function CatalogSwitcher({ options, current, client }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const showClient = client && !client.isDefault;
  if (options.length < 2 && !showClient) return null;
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-soft">
      {showClient ? (
        <span>
          {t.clientLabel}: <Link href={`/clients/${client.id}`} className="font-medium text-ink underline">{client.name}</Link>
        </span>
      ) : null}
      {options.length >= 2 ? (
        <label className="flex flex-wrap items-center gap-2">
          <span>{t.catalogSwitch}:</span>
          <select
            value={current}
            onChange={(e) => router.push(`${pathname}?catalog=${encodeURIComponent(e.target.value)}`)}
            className="max-w-full border border-rule bg-paper px-2 py-1 text-ink focus:border-ink focus:outline-none"
          >
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}
