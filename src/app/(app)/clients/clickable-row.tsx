'use client';

import { useRouter } from 'next/navigation';
import type { MouseEvent, ReactNode } from 'react';
import { Tr } from '@/ui/table';

/**
 * A table row that opens `href` when clicked anywhere. The row's own link stays
 * the keyboard and middle-click target; clicks on inner controls or text being
 * selected are left alone.
 */
export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLTableRowElement>): void => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, summary')) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  };
  return <Tr interactive onClick={onClick}>{children}</Tr>;
}
