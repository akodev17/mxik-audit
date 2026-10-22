// Keeps reads working when the database holds a finding type this Prisma client
// was generated without. Prisma then refuses the whole read ("Value 'X' not
// found in enum 'FindingType'"), so one new type would take down every page that
// lists findings. On exactly that error, and only for reads, the read runs again
// with the type column left out, and the column is filled in from a second query
// that reads it as text: a known value comes back as is, an unknown one as
// 'OTHER' (finding-type.ts). With a client that matches the database the first
// attempt succeeds and nothing here runs.
//
// Limits: the second query runs outside any interactive transaction, so a
// finding created in that transaction and not yet committed reads as 'OTHER';
// a read inside a batch $transaction([...]) is not retried. Writes are not
// retried either (a write must not run twice): finding writes select only the id.
import { Prisma } from '@prisma/client';
import { readFindingType } from './finding-type.js';

const READS = new Set(['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow']);

type Args = Record<string, unknown>;
/** Where a finding sits in a result: the relation fields from the root, and whether its id was added only for the fill. */
type Need = { path: string[]; dropId: boolean };

/** Model name -> relation field -> related model name. */
const RELATIONS = new Map(Prisma.dmmf.datamodel.models.map((m) => [
  m.name,
  new Map(m.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type])),
]));

export function isUnknownFindingType(error: unknown): boolean {
  return error instanceof Error && /not found in enum 'FindingType'/.test(error.message);
}

/** A copy of the query args that never returns Finding.type, and where each finding sits in the result. */
export function withoutFindingType(model: string, args: Args, path: string[] = [], needs: Need[] = []): { args: Args; needs: Need[] } {
  const out: Args = { ...args };
  if (model === 'Finding') {
    const select = args['select'] as Args | undefined;
    if (select) {
      if (select['type']) {
        const rest = { ...select };
        delete rest['type'];
        out['select'] = { ...rest, id: true };
        needs.push({ path, dropId: !rest['id'] });
      }
    } else {
      const omit = args['omit'] as Args | undefined;
      if (omit?.['type'] !== true) {
        out['omit'] = { ...omit, type: true, id: false };
        needs.push({ path, dropId: omit?.['id'] === true });
      }
    }
  }
  const relations = RELATIONS.get(model);
  for (const key of ['select', 'include']) {
    const tree = out[key] as Args | undefined;
    if (!tree || !relations) continue;
    const next: Args = { ...tree };
    for (const [field, value] of Object.entries(tree)) {
      const target = relations.get(field);
      if (!target || !value) continue;
      // `true` returns only the related model's scalars: that matters only when it is a finding.
      if (value === true) {
        if (target === 'Finding') next[field] = withoutFindingType(target, {}, [...path, field], needs).args;
      } else {
        next[field] = withoutFindingType(target, value as Args, [...path, field], needs).args;
      }
    }
    out[key] = next;
  }
  return { args: out, needs };
}

/** The finding records at `path` in a result (a record, a list, or null at any level). */
export function findingsAt(value: unknown, path: readonly string[], out: Args[] = []): Args[] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    for (const v of value) findingsAt(v, path, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  const [head, ...rest] = path;
  if (head === undefined) out.push(value as Args);
  else findingsAt((value as Args)[head], rest, out);
  return out;
}

/** Sets `type` on every finding the rewritten read returned, from the column read as text. */
export async function fillFindingTypes(result: unknown, needs: readonly Need[], readTypes: (ids: string[]) => Promise<Map<string, string>>): Promise<void> {
  const found = needs.map((n) => ({ need: n, records: findingsAt(result, n.path) }));
  const ids = [...new Set(found.flatMap((f) => f.records.map((r) => String(r['id']))))];
  const types = ids.length === 0 ? new Map<string, string>() : await readTypes(ids);
  for (const { need, records } of found) {
    for (const r of records) {
      r['type'] = readFindingType(types.get(String(r['id'])));
      if (need.dropId) delete r['id'];
    }
  }
}

let warned = false;

export const findingTypeFallback = Prisma.defineExtension((client) => {
  const readTypes = async (ids: string[]) => {
    const rows = await client.$queryRaw<{ id: string; type: string }[]>`SELECT id, type::text AS type FROM finding WHERE id = ANY(${ids})`;
    return new Map(rows.map((r) => [r.id, r.type]));
  };
  return client.$extends({
    name: 'finding-type-fallback',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!READS.has(operation)) return query(args);
          try {
            return await query(args);
          } catch (error) {
            if (!isUnknownFindingType(error)) throw error;
            if (!warned) {
              warned = true;
              console.warn('[db] finding_type holds a value this Prisma client does not know; reading it as OTHER. Regenerate the client (npx prisma generate) and restart the app.');
            }
            const rewritten = withoutFindingType(model, args ?? {});
            const result = await query(rewritten.args);
            await fillFindingTypes(result, rewritten.needs, readTypes);
            return result;
          }
        },
      },
    },
  });
});
