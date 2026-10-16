'use client';

import { useI18n } from '@/lib/locale-client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { IconSearch } from '../icons';

const CATALOG_PATH = /^\/catalogs\/([^/]+)$/;

/** Product name or code search; lands on the catalogue workspace with ?q=. */
export function GlobalSearch({ latestCatalogId }: { latestCatalogId: string | null }) {
  const { ta } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');

  function submit(e: FormEvent): void {
    e.preventDefault();
    const q = value.trim();
    const onCatalog = CATALOG_PATH.test(pathname);
    const target = onCatalog ? pathname : latestCatalogId ? `/catalogs/${latestCatalogId}` : '/catalogs';
    const next = new URLSearchParams(onCatalog ? params.toString() : '');
    if (q) next.set('q', q); else next.delete('q');
    const qs = next.toString();
    router.push(qs ? `${target}?${qs}` : target);
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full max-w-md">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><IconSearch /></span>
      <input
        id="app-search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={ta.shell.searchPlaceholder}
        aria-label={ta.shell.searchLabel}
        className="h-9 w-full rounded-ctl border border-line bg-surface pl-10 pr-3 text-sm placeholder:text-muted focus:border-brand focus:bg-base focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </form>
  );
}
