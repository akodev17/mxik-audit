'use client';

import type { RefObject } from 'react';
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
import { activeFilters, FilterControls, useFilterNav, type FilterField } from './filter-controls';
import { ViewsMenu } from './views-menu';
import { WsSearch } from './ws-search';
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
  searchRef: RefObject<HTMLInputElement | null>;
  onCompact: (v: boolean) => void;
  onGrouped: (v: boolean) => void;
  onHidden: (v: OptionalColumn[]) => void;
  onApplyView: (p: ViewParams) => void;
  onAcceptSure: () => void;
  onAcceptDictionary: () => void;
  onHelp: () => void;
};

/** Less used filters sit behind one button on desktop, so the toolbar stays one line on a laptop. */
const MORE: readonly FilterField[] = ['flag', 'sort', 'commented'];

/** Search, filters, saved views, layout and the catalogue-wide accept buttons for the grid below. */
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
  const dictLabel = count(locale, x.dictButton, p.dictionaryPending);
  const sureLabel = p.surePending === 0 ? x.sure.buttonNone : count(locale, x.sure.button, p.surePending);
  const filters = (fields?: readonly FilterField[]) => {
    const n = activeFilters(filter, fields);
    return (
      <Popover label={n > 0 ? x.filter.active(n) : x.filter.button} title={x.filter.button} size="sm" panelClassName="w-[min(20rem,calc(100vw-2rem))]">
        <FilterControls filter={filter} stacked fields={fields} />
      </Popover>
    );
  };
  const source = filter.source ? (
    <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-brand-tint pl-3 pr-1 text-small text-brand-ink">
      <span className="truncate">{x.filter.source(decisionSourceLabel(filter.source, ta))}</span>
      <IconButton size="compact" label={x.filter.clearSource} icon={<IconX size={14} />} onClick={() => go((q) => q.delete('source'))} />
    </span>
  ) : null;
  const accepts = p.readOnly ? null : (
    <>
      {p.dictionaryPending === 0 ? null : (
        <Button size="sm" variant="secondary" className="max-w-full" disabled={p.busy} onClick={p.onAcceptDictionary} title={dictLabel}>
          <span className="min-w-0 truncate">{dictLabel}</span>
        </Button>
      )}
      <Button size="sm" variant="secondary" className="max-w-full" disabled={p.busy || p.surePending === 0} onClick={p.onAcceptSure} title={sureLabel}>
        <span className="min-w-0 truncate">{sureLabel}</span>
      </Button>
    </>
  );
  const findings = <span className="shrink-0 text-small font-medium text-fg" aria-live="polite">{count(locale, x.count.findings, p.count)}</span>;

  if (p.phone) {
    return (
      <div className="no-print space-y-2 border-b border-line px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {findings}
          {filters()}
          <span className="ml-auto"><ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} /></span>
        </div>
        <WsSearch value={filter.q} inputRef={p.searchRef} />
        {source}
        {accepts ? <div className="flex flex-wrap items-center gap-2">{accepts}</div> : null}
      </div>
    );
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 md:gap-3 md:px-5">
      {findings}
      <WsSearch value={filter.q} inputRef={p.searchRef} />
      {source}
      <FilterControls filter={filter} stacked={false} fields={['decision']} />
      {filters(MORE)}
      {accepts}
      {p.grouped && p.partialGroups ? <span className="text-micro text-muted">{x.group.loadedOnly}</span> : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} />
        <ColumnsMenu hidden={p.hidden} compact={p.compact} grouped={p.grouped} onHidden={p.onHidden} onCompact={p.onCompact} onGrouped={p.onGrouped} />
        {p.touch ? null : (
          <IconButton label={x.keys.open} icon={<Kbd>?</Kbd>} variant="ghost" size="sm" onClick={p.onHelp} tooltipAlign="end" />
        )}
      </div>
    </div>
  );
}
