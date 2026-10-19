'use client';

import { decisionSourceLabel } from '@/lib/decision-source';
import { useI18n } from '@/lib/locale-client';
import type { OptionalColumn, ViewParams } from '@/lib/view-params';
import type { WsFilter } from '@/lib/workspace-filter';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { IconX } from '@/ui/icons';
import { Kbd } from '@/ui/kbd';
import { Popover } from '@/ui/popover';
import { ColumnsMenu } from './columns-menu';
import { activeFilters, FilterControls, useFilterNav } from './filter-controls';
import { ViewsMenu } from './views-menu';
import { count } from './ws-text';

type Props = {
  filter: WsFilter;
  count: number;
  compact: boolean;
  grouped: boolean;
  hidden: OptionalColumn[];
  phone: boolean;
  touch: boolean;
  readOnly: boolean;
  busy: boolean;
  saveBlocked: string | null;
  surePending: number;
  dictionaryPending: number;
  /** Groups are built from loaded rows only while more pages wait on the server. */
  partialGroups: boolean;
  onCompact: (v: boolean) => void;
  onGrouped: (v: boolean) => void;
  onHidden: (v: OptionalColumn[]) => void;
  onApplyView: (p: ViewParams) => void;
  onAcceptSure: () => void;
  onAcceptDictionary: () => void;
  onHelp: () => void;
};

/** Filters, saved views, layout and the catalogue-wide accept buttons for the grid below. */
export function Toolbar(p: Props) {
  const { ta, locale } = useI18n();
  const x = ta.wsX;
  const go = useFilterNav();
  const { filter } = p;
  const current: ViewParams = {
    type: filter.type, q: filter.q, pending: filter.decision === 'pending', decision: filter.decision, flag: filter.flag,
    comments: filter.commented, sort: filter.sort, density: p.compact ? 'compact' : 'comfortable', grouped: p.grouped, hidden: p.hidden,
    ...(filter.source ? { source: filter.source } : {}),
  };
  const n = activeFilters(filter);
  const dictLabel = count(locale, x.dictButton, p.dictionaryPending);
  const sureLabel = p.surePending === 0 ? x.sure.buttonNone : count(locale, x.sure.button, p.surePending);

  return (
    <div className="no-print space-y-2 border-b border-line px-4 py-2 md:px-5">
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <span className="text-small font-medium text-fg" aria-live="polite">{count(locale, x.count.findings, p.count)}</span>
        {filter.q ? (
          <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-brand-tint pl-3 pr-1 text-small text-brand-ink">
            <span className="truncate">{x.filter.search(filter.q)}</span>
            <IconButton size="compact" label={x.filter.clearSearch} icon={<IconX size={14} />} onClick={() => go((q) => q.delete('q'))} />
          </span>
        ) : null}
        {filter.source ? (
          <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-brand-tint pl-3 pr-1 text-small text-brand-ink">
            <span className="truncate">{x.filter.source(decisionSourceLabel(filter.source, ta))}</span>
            <IconButton size="compact" label={x.filter.clearSource} icon={<IconX size={14} />} onClick={() => go((q) => q.delete('source'))} />
          </span>
        ) : null}
        {p.phone ? (
          <Popover label={n > 0 ? x.filter.active(n) : x.filter.button} title={x.filter.button} size="sm" panelClassName="w-[calc(100vw-2rem)]">
            <FilterControls filter={filter} stacked />
          </Popover>
        ) : <FilterControls filter={filter} stacked={false} />}
        {p.phone ? <span className="ml-auto"><ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} /></span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        {p.readOnly || p.dictionaryPending === 0 ? null : (
          <Button size="sm" variant="secondary" className="max-w-full" disabled={p.busy} onClick={p.onAcceptDictionary} title={dictLabel}>
            <span className="min-w-0 truncate">{dictLabel}</span>
          </Button>
        )}
        {p.readOnly ? null : (
          <Button size="sm" variant="secondary" className="max-w-full" disabled={p.busy || p.surePending === 0} onClick={p.onAcceptSure} title={sureLabel}>
            <span className="min-w-0 truncate">{sureLabel}</span>
          </Button>
        )}
        {p.grouped && p.partialGroups ? <span className="text-micro text-muted">{x.group.loadedOnly}</span> : null}
        {p.phone ? null : (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} />
            <ColumnsMenu hidden={p.hidden} compact={p.compact} grouped={p.grouped} onHidden={p.onHidden} onCompact={p.onCompact} onGrouped={p.onGrouped} />
            {p.touch ? null : (
              <IconButton label={x.keys.open} icon={<Kbd>?</Kbd>} variant="ghost" size="sm" onClick={p.onHelp} tooltipAlign="end" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
