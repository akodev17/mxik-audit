// Draft text for requesting a new MXIK code on tasnif.soliq.uz, for rows where
// no candidate fits. Only drafts: nothing is ever submitted from here.
import { z } from 'zod';
import { catalogScope } from './access.js';
import { codeDetails } from './code-details.js';
import { ColumnMapSchema } from './column-map.js';
import { db } from './db.js';

const Original = z.object({ original: z.array(z.string()) });
const Alternatives = z.array(z.object({ code: z.string() }).passthrough());
const DETAIL_CELLS = 6;

/** The row's other cells ("Artikul: X; Brend: Y"), as a description the user can edit. */
function describe(headers: readonly string[], cells: readonly string[], mapped: ReadonlySet<number>): string {
  return headers
    .flatMap((h, i) => (mapped.has(i) || !cells[i]?.trim() ? [] : [`${h}: ${cells[i]?.trim() ?? ''}`]))
    .slice(0, DETAIL_CELLS)
    .join('; ');
}

/** Scoped like every row read: the org, and for an accountant with assigned clients, only those clients. */
export async function codeRequestText(scope: { orgId: string; clientIds?: string[] | null }, findingId: string): Promise<string | null> {
  const finding = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(scope) } },
    select: {
      suggestedMxik: true, alternatives: true, decision: true,
      item: { select: { rawName: true, unit: true, barcode: true, attrs: true, catalog: { select: { headers: true, columnMap: true } } } },
    },
  });
  if (!finding) return null;
  const { item } = finding;
  const map = ColumnMapSchema.safeParse(item.catalog.columnMap);
  const mapped = new Set(map.success ? [map.data.name, map.data.mxik, map.data.barcode, map.data.unit].filter((i) => i >= 0) : []);
  const cells = Original.safeParse(item.attrs).data?.original ?? [];
  const description = describe(item.catalog.headers, cells, mapped);

  // The nearest the classifier came: the suggestion, unless the reviewer
  // rejected it, then the next alternative.
  const alternatives = (Alternatives.safeParse(finding.alternatives).data ?? []).map((a) => a.code);
  const rejected = finding.decision === 'rejected' ? finding.suggestedMxik : null;
  const nearestCode = [finding.suggestedMxik, ...alternatives].find((c): c is string => c !== null && c !== rejected) ?? null;
  const nearest = nearestCode ? (await codeDetails([nearestCode])).get(nearestCode) ?? null : null;

  return [
    'Yangi MXIK kodi soʻrovi — tasnif.soliq.uz uchun qoralama',
    '',
    `Tovar nomi: ${item.rawName}`,
    `Tavsif: ${description || '—'}`,
    `Oʻlchov birligi: ${item.unit ?? '—'}`,
    `Shtrix-kod: ${item.barcode ?? '—'}`,
    nearest
      ? `Tasniflagichdagi eng yaqin guruh: ${nearest.fullPath} (pozitsiya ${nearest.code.slice(0, 8)})`
      : 'Tasniflagichdagi eng yaqin guruh: aniqlanmadi',
    nearest ? `Eng yaqin mavjud kod: ${nearest.code} — ${nearest.name} (tovarga mos emas)` : null,
    '',
    'Izoh: tasniflagichda bu tovarga mos kod topilmadi.',
  ].filter((line): line is string => line !== null).join('\n');
}
