// The brief's golden case #5 assumes pre-Aug-2022 medical service codes were all
// revoked. Check whether service codes exist in the current export at all.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

type Rec = {
  code: string; nameUz: string | null; nameRu: string | null;
  unitCanonical: string[]; groupCode: string; groupNameUz: string | null;
  isBase: boolean; isMarked: boolean | null;
};

const serviceUnit: Rec[] = [];
const medical: Rec[] = [];
const groupsWithServices = new Map<string, number>();
let total = 0;

const rl = createInterface({ input: createReadStream('data/mxik.ndjson', 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  const r = JSON.parse(line) as Rec;
  total++;
  const nu = (r.nameUz ?? '').toLowerCase();
  const nr = (r.nameRu ?? '').toLowerCase();
  if (r.unitCanonical.some((u) => u.startsWith('xizmat'))) {
    serviceUnit.push(r);
    groupsWithServices.set(r.groupCode, (groupsWithServices.get(r.groupCode) ?? 0) + 1);
  }
  if (/tibbiy|tibbiyot/.test(nu) || /медицин/.test(nr)) {
    if (medical.length < 2000) medical.push(r);
  }
}

console.log(`total records: ${total.toLocaleString()}`);
console.log(`\ncodes whose bound unit is a service ("xizmat*"): ${serviceUnit.length}`);
console.log('groups carrying them:');
[...groupsWithServices].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([g, n]) => {
  const ex = serviceUnit.find((r) => r.groupCode === g);
  console.log(`  grp ${g}  n=${String(n).padStart(4)}  ${(ex?.groupNameUz ?? '').slice(0, 50)}`);
});
console.log('\nsample service codes:');
serviceUnit.slice(0, 8).forEach((r) => console.log(`  ${r.code}  base=${r.isBase ? 'Y' : 'n'}  ${(r.nameUz ?? '').slice(0, 62)}`));

console.log(`\ncodes mentioning medical (tibbiy / медицин): ${medical.length}`);
medical.slice(0, 10).forEach((r) => console.log(`  ${r.code}  ${(r.nameUz ?? '').slice(0, 68)}`));

// Are any *services* rather than goods? Look for the dedicated service groups.
const svcGroups = new Set(serviceUnit.map((r) => r.groupCode));
console.log(`\ndistinct groups with service-unit codes: ${svcGroups.size}`);
