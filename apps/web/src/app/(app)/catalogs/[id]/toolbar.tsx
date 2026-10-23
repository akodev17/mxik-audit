'use client';

import type { RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { OptionalColumn, ViewParams, WsFilter } from '@/lib/workspace-url';
import { Button } from '@/ui/button';
import { IconButton } from '@/ui/icon-button';
import { IconCheck } from '@/ui/icons';
import { Kbd } from '@/ui/kbd';
import { Popover } from '@/ui/popover';
import { ColumnsMenu } from './columns-menu';
import { activeFilters, FilterControls, type FilterField } from './filter-controls';
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

/**
 * One 40px line over the grid: what the list holds, search, the decision filter and the rest of the
 * filters on the left; the catalogue-wide accept buttons, saved views, table settings and the
 * shortcut list on the right. Every control is 32px high. Active filters show as chips below it.
 */
export function Toolbar(p: Props) {
  const { ta, locale } = useI18n();
  const x = ta.wsX;
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
      <Popover label={n > 0 ? x.filter.active(n) : x.filter.button} title={x.filter.button} size="sm" variant={n > 0 ? 'secondary' : 'ghost'} panelClassName="w-[min(20rem,calc(100vw-2rem))]">
        <FilterControls filter={filter} stacked fields={fields} />
      </Popover>
    );
  };
  const accepts = p.readOnly ? null : (
    <>
      {p.dictionaryPending === 0 ? null : (
        <Button size="sm" variant="secondary" className="min-w-0 max-w-full" disabled={p.busy} onClick={p.onAcceptDictionary} title={dictLabel}>
          <span className="min-w-0 truncate">{dictLabel}</span>
        </Button>
      )}
      <Button size="sm" variant="secondary" className="min-w-0 max-w-full" disabled={p.busy || p.surePending === 0} onClick={p.onAcceptSure} title={sureLabel}>
        <IconCheck size={14} className="shrink-0 text-good-ink" />
        <span className="min-w-0 truncate">{p.surePending === 0 ? sureLabel : count(locale, ta.wsUi.sureShort, p.surePending)}</span>
      </Button>
    </>
  );
  const findings = <span className="shrink-0 text-small font-semibold tabular-nums text-fg" aria-live="polite">{count(locale, x.count.findings, p.count)}</span>;

  if (p.phone) {
    return (
      <div className="no-print space-y-2 border-b border-line px-4 py-2">
        <WsSearch value={filter.q} inputRef={p.searchRef} />
        <div className="flex flex-wrap items-center gap-2">
          {findings}
          <span className="ml-auto flex items-center gap-2">
            {filters()}
            <ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} />
          </span>
        </div>
        {accepts ? <div className="flex flex-wrap items-center gap-2">{accepts}</div> : null}
      </div>
    );
  }

  return (
    <div className="no-print flex min-h-12 flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2 md:px-5">
      {findings}
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <WsSearch value={filter.q} inputRef={p.searchRef} />
      <FilterControls filter={filter} stacked={false} fields={['decision']} />
      {filters(MORE)}
      {p.grouped && p.partialGroups ? <span className="text-micro text-muted">{x.group.loadedOnly}</span> : null}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {accepts}
        {accepts ? <span aria-hidden className="mx-1 hidden h-5 w-px bg-line lg:block" /> : null}
        <ViewsMenu current={current} saveBlocked={p.saveBlocked} onApply={p.onApplyView} />
        <ColumnsMenu hidden={p.hidden} compact={p.compact} grouped={p.grouped} onHidden={p.onHidden} onCompact={p.onCompact} onGrouped={p.onGrouped} />
        {p.touch ? null : (
          <IconButton label={x.keys.open} icon={<Kbd>?</Kbd>} variant="ghost" size="sm" onClick={p.onHelp} tooltipAlign="end" />
        )}
      </div>
    </div>
  );
}
