import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Section } from '@/ui/page';
import { CloseAccount } from './close-account';
import { ExportButton, RetentionSetting } from './data-panel';

/** Admin only: export, raw-file retention, and closing the account in a separate danger zone at the end. */
export async function DataTab({ user }: { user: Me }) {
  if (user.role !== 'admin') return null;
  const { ta } = await getI18n();
  const s = ta.setX.data;
  const org = await serverApi().account.get();

  return (
    <>
      <Section title={s.export} hint={s.exportHint}>
        <ExportButton />
      </Section>

      <Section title={s.retention} hint={s.retentionHint}>
        <RetentionSetting initial={org} />
      </Section>

      <section aria-labelledby="danger-zone" className="mt-12 max-w-2xl rounded-lg border border-danger p-4 sm:p-5">
        <h2 id="danger-zone" className="text-section text-danger-ink">{s.danger}</h2>
        <h3 className="mt-3 text-small font-semibold">{s.close}</h3>
        <p className="mb-3 mt-1 text-small text-muted">{s.closeHint(org.closeAfterDays)}</p>
        <CloseAccount days={org.closeAfterDays} />
      </section>
    </>
  );
}
