'use client';

import { usePathname, useRouter } from 'next/navigation';
import { t } from '@/lib/i18n';

export type CatalogOption = { id: string; label: string };

/** Lets report, review and export work on any earlier catalogue, not just the latest. */
export function CatalogSwitcher({ options, current }: { options: CatalogOption[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (options.length < 2) return null;
  return (
    <label className="no-print mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
      <span>{t.catalogSwitch}:</span>
      <select
        value={current}
        onChange={(e) => router.push(`${pathname}?catalog=${encodeURIComponent(e.target.value)}`)}
        className="max-w-full border border-rule bg-paper px-2 py-1 text-ink focus:border-ink focus:outline-none"
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}
