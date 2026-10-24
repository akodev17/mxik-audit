import { MODULE_KEYS } from '@tasnivo/contracts/feature-modules';
import { getI18n } from '@/lib/locale';
import { getModuleStates } from '@/lib/modules';
import { Badge } from '@/ui/badge';
import { Card } from './card';

/** Modules set to COMING_SOON on /admin/features: name and description, muted, not links. Nothing when there are none. */
export async function ComingSoonModules() {
  const [{ ta }, states] = await Promise.all([getI18n(), getModuleStates()]);
  const soon = MODULE_KEYS.filter((key) => states[key] === 'COMING_SOON');
  if (soon.length === 0) return null;
  const f = ta.featuresX;
  return (
    <Card id="coming-soon" title={f.dashboard.title} hint={f.dashboard.hint}>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {soon.map((key) => (
          <li key={key} aria-disabled="true" className="cursor-default rounded-ctl border border-dashed border-line px-3 py-2.5 text-muted">
            <span className="flex items-center gap-2 text-data font-medium">{f.modules[key].label}<Badge>{f.soon}</Badge></span>
            <span className="mt-0.5 block text-small text-subtle">{f.modules[key].description}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
