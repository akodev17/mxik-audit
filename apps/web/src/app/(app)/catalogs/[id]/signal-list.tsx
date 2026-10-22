'use client';

import { useI18n } from '@/lib/locale-client';
import type { Signal } from './ws-types';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';

const DOT = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-danger', neutral: 'bg-line-strong' } as const;

/** "Nega bu kod?": the evidence behind a suggestion. Text the model wrote carries an AI badge and its caveat. */
export function SignalList({ signals }: { signals: Signal[] }) {
  const { ta } = useI18n();
  if (signals.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-small font-semibold text-fg">{ta.wsX.drawer.why}</h3>
      <ul className="space-y-2">
        {signals.map((s) => (
          <li key={`${s.label}:${s.text}`} className="flex items-start gap-2 text-small">
            <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', DOT[s.tone])} />
            <span className="min-w-0">
              {s.source === 'ai' ? <Badge tone="info" className="mr-1.5 align-middle">{ta.wsX.drawer.aiBadge}</Badge> : <span className="font-medium text-fg">{s.label}. </span>}
              <span className="text-muted">{s.text}</span>
              {s.note ? <span className="mt-0.5 block text-micro text-muted">{s.note}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
