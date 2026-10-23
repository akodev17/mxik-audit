import type { CatalogListItem } from '@/lib/catalogs/types';
import type { Tone } from '@/ui/badge';

/** A catalogue's status as a chip tone: the list and the workspace header say it the same way. */
export const STATUS_TONE: Record<CatalogListItem['status'], Tone> = { ready: 'good', analyzing: 'info', failed: 'danger', uploaded: 'neutral' };
