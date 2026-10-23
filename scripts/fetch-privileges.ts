// Loads the portal's tax-privilege reference into tax_privilege, so the ids in
// mxik_code.taxPrivilegeIds can be shown with their wording and legal basis.
// Public endpoint, found in the Gate 0 data inspection. See docs/scoring.md, Appendix A.
// Run: npm run privileges:fetch
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { z } from 'zod';
import { db } from '@tasnivo/db';

const URL = 'https://tasnif.soliq.uz/api/cls-api/integration-mxik/references/lgota';

const Entry = z.object({
  id: z.union([z.number(), z.string()]),
  nameLatn: z.string().nullish(),
  nameRu: z.string().nullish(),
  docNum: z.number().nullish(),
  docDate: z.number().nullish(),
  docNameLatn: z.string().nullish(),
});

const response = await fetch(URL);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const raw: unknown = await response.json();
const list = z.array(z.unknown()).parse(Array.isArray(raw) ? raw : (raw as { data?: unknown }).data);
const entries = list.flatMap((item) => {
  const parsed = Entry.safeParse(item);
  return parsed.success ? [parsed.data] : [];
});

for (const e of entries) {
  const data = {
    nameLatn: e.nameLatn ?? null,
    nameRu: e.nameRu ?? null,
    docNum: e.docNum ?? null,
    docDate: e.docDate ? new Date(e.docDate) : null,
    docNameLatn: e.docNameLatn ?? null,
    fetchedAt: new Date(),
  };
  await db.taxPrivilege.upsert({ where: { id: String(e.id) }, create: { id: String(e.id), ...data }, update: data });
}
const linked = await db.$queryRaw<{ n: bigint }[]>`
  SELECT count(DISTINCT id) AS n FROM (SELECT unnest("taxPrivilegeIds") AS id FROM mxik_code WHERE "retiredAt" IS NULL) x
  WHERE id <> '0' AND id NOT IN (SELECT id FROM tax_privilege)`;
console.log(`privileges loaded: ${entries.length} of ${list.length}; ids used by codes but missing from the reference: ${Number(linked[0]?.n ?? 0)}`);
await db.$disconnect();
