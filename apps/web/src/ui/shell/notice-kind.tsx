// The mark beside a notification: what kind of event it is, in shape and colour (the title says it in words).
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { IconBell, IconSuccess, IconTable } from '../icons';
import { IconHash, IconQueue } from './icons';

type Look = { icon: ReactNode; tone: string };

const LOOKS: Record<string, Look> = {
  'review.assigned': { icon: <IconQueue size={16} />, tone: 'bg-brand-tint text-brand-ink' },
  'review.completed': { icon: <IconSuccess size={16} />, tone: 'bg-good-tint text-good-ink' },
  'catalog.ready': { icon: <IconTable size={16} />, tone: 'bg-info-tint text-info-ink' },
  'classifier.updated': { icon: <IconHash size={16} />, tone: 'bg-warn-tint text-warn-ink' },
};
const OTHER: Look = { icon: <IconBell size={16} />, tone: 'bg-sunken text-muted' };

/** Decorative: the notice's title already names the event. */
export function NoticeMark({ kind, className }: { kind: string; className?: string }) {
  const look = LOOKS[kind] ?? OTHER;
  return <span aria-hidden className={cx('grid size-8 shrink-0 place-items-center rounded-full', look.tone, className)}>{look.icon}</span>;
}
