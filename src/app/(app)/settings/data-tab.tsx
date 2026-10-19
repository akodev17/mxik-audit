import { isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { deleteAfterDays, RETENTION_CHOICES } from '@/lib/security/account';
import type { CurrentUser } from '@/lib/session';
import { Section } from '@/ui/page';
import { CloseAccount } from './close-account';
import { ExportButton, RetentionSetting } from './data-panel';

/** Admin only: export, raw-file retention, and closing the account in a separate danger zone at the end. */
export async function DataTab({ user }: { user: CurrentUser }) {
  if (!isAdminRole(user)) return null;
  const { locale, ta } = await getI18n();
  const s = ta.setX.data;
  const org = await db.organization.findUniqueOrThrow({ where: { id: user.orgId }, select: { rawRetentionDays: true, rawRetentionSince: true } });

  return (
    <>
      <Section title={s.export} hint={s.exportHint}>
        <ExportButton />
      </Section>

      <Section title={s.retention} hint={s.retentionHint}>
        <RetentionSetting value={org.rawRetentionDays} choices={RETENTION_CHOICES} since={org.rawRetentionSince ? fmtDate(locale, org.rawRetentionSince) : null} />
      </Section>

      <section aria-labelledby="danger-zone" className="mt-12 max-w-2xl rounded-lg border border-danger p-4 sm:p-5">
        <h2 id="danger-zone" className="text-section text-danger-ink">{s.danger}</h2>
        <h3 className="mt-3 text-small font-semibold">{s.close}</h3>
        <p className="mb-3 mt-1 text-small text-muted">{s.closeHint(deleteAfterDays())}</p>
        <CloseAccount days={deleteAfterDays()} />
      </section>
    </>
  );
}
