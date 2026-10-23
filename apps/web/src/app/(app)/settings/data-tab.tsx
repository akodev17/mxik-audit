import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { IconAlert } from '@/ui/icons';
import { Card } from '../_manage/card';
import { CloseAccount } from './close-account';
import { ExportButton, RetentionSetting } from './data-panel';

/** Admin only: export, raw-file retention, and closing the account in a separate danger zone at the end. */
export async function DataTab({ user }: { user: Me }) {
  if (user.role !== 'admin') return null;
  const { ta } = await getI18n();
  const s = ta.setX.data;
  const org = await serverApi().account.get();

  return (
    <div className="space-y-4">
      <Card id="export" title={s.export} hint={s.exportHint}>
        <ExportButton />
      </Card>

      <Card id="retention" title={s.retention} hint={s.retentionHint}>
        <RetentionSetting initial={org} />
      </Card>

      <Card id="danger-zone" title={s.danger} tone="danger" className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-danger-tint text-danger-ink"><IconAlert size={16} /></span>
            <div className="min-w-0">
              <h3 className="font-semibold">{s.close}</h3>
              <p className="mt-0.5 max-w-xl text-small text-muted">{s.closeHint(org.closeAfterDays)}</p>
            </div>
          </div>
          <div className="shrink-0"><CloseAccount days={org.closeAfterDays} /></div>
        </div>
      </Card>
    </div>
  );
}
