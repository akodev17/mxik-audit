'use client';

import { useI18n } from '@/lib/locale-client';
import { OPTIONAL_COLUMNS, type OptionalColumn } from '@tasnivo/domain/view-params';
import { Checkbox } from '@/ui/checkbox';
import { Popover } from '@/ui/popover';
import { Segmented } from '@/ui/segmented';

type Props = {
  hidden: readonly OptionalColumn[];
  compact: boolean;
  grouped: boolean;
  onHidden: (hidden: OptionalColumn[]) => void;
  onCompact: (v: boolean) => void;
  onGrouped: (v: boolean) => void;
};

/** Table settings in one place: list or groups, density, and which optional columns show. All saved with a view. */
export function ColumnsMenu({ hidden, compact, grouped, onHidden, onCompact, onGrouped }: Props) {
  const { ta } = useI18n();
  const x = ta.wsX;
  const off = new Set(hidden);
  const toggle = (c: OptionalColumn, visible: boolean): void => {
    const next = new Set(off);
    if (visible) next.delete(c); else next.add(c);
    onHidden(OPTIONAL_COLUMNS.filter((k) => next.has(k)));
  };
  return (
    <Popover label={x.columns.button} title={x.columns.button} size="sm" align="end">
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-small font-medium text-fg">{x.view.layout}</p>
          <Segmented label={x.view.layout} value={grouped ? 'g' : 'f'} onChange={(v) => onGrouped(v === 'g')} options={[{ value: 'f', label: x.view.flat }, { value: 'g', label: x.view.grouped }]} />
        </div>
        <div className="space-y-1">
          <p className="text-small font-medium text-fg">{x.view.density}</p>
          <Segmented label={x.view.density} value={compact ? 'c' : 'k'} onChange={(v) => onCompact(v === 'c')} options={[{ value: 'k', label: x.view.comfortable }, { value: 'c', label: x.view.compact }]} />
        </div>
        <fieldset>
          <legend className="mb-1 text-small font-medium text-fg">{x.columns.title}</legend>
          <div className="flex flex-col items-start gap-2">
            {OPTIONAL_COLUMNS.map((c) => (
              <Checkbox key={c} label={x.col[c]} checked={!off.has(c)} onChange={(e) => toggle(c, e.target.checked)} />
            ))}
          </div>
          <p className="pt-2 text-micro text-muted">{x.columns.hint}</p>
        </fieldset>
      </div>
    </Popover>
  );
}
