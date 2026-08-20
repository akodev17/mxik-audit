// Validates the transliterator against the classifier's own parallel names.
// The portal publishes every code in both scripts, so the catalogue is a free
// 438,925-pair ground truth. Reports exact-match rate and the character rules
// responsible for the biggest residual disagreements.
// Run: npm run eval:translit
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { cyrillicToLatin, scriptAlternates } from '../src/core/normalize/script.js';
import { matchKeyOf } from '../src/core/normalize/index.js';

type Rec = { code: string; nameUz: string | null; nameUzCyrl: string | null };

const LIMIT = Number(process.env['TRANSLIT_LIMIT'] ?? '0') || Infinity;

let pairs = 0;
let exact = 0;
let foldedExact = 0;
let viaAlternates = 0;
const mismatchSamples: { code: string; cyr: string; expected: string; got: string }[] = [];
// Attribute the difference to a character rule by diffing at the first divergence.
const divergence = new Map<string, number>();

const rl = createInterface({ input: createReadStream('data/mxik.ndjson', 'utf8'), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line) continue;
  if (pairs >= LIMIT) break;
  const r = JSON.parse(line) as Rec;
  const cyr = r.nameUzCyrl;
  const expected = r.nameUz;
  if (!cyr || !expected) continue;
  pairs++;

  const got = cyrillicToLatin(cyr);
  if (got === expected) { exact++; continue; }

  // The fold is what actually feeds retrieval, so measure it separately.
  const foldedGot = matchKeyOf(got);
  const foldedExpected = matchKeyOf(expected);
  if (foldedGot === foldedExpected) { foldedExact++; continue; }

  // Retrieval indexes ц both ways, so an alternate hit is a real hit.
  const alts = new Set(scriptAlternates(foldedGot));
  if (scriptAlternates(foldedExpected).some((a) => alts.has(a))) { viaAlternates++; continue; }

  // Only fold-level disagreements can hurt matching, so attribute those.
  let i = 0;
  while (i < foldedGot.length && i < foldedExpected.length && foldedGot[i] === foldedExpected[i]) i++;
  const gotSlice = foldedGot.slice(i, i + 3);
  const expSlice = foldedExpected.slice(i, i + 3);
  const cause = `${JSON.stringify(expSlice)} expected, got ${JSON.stringify(gotSlice)}`;
  divergence.set(cause, (divergence.get(cause) ?? 0) + 1);
  if (mismatchSamples.length < 25) mismatchSamples.push({ code: r.code, cyr, expected, got });
}

const exactPct = (exact / pairs) * 100;
const foldPct = ((exact + foldedExact) / pairs) * 100;

console.log(`pairs compared          ${pairs.toLocaleString()}`);
console.log(`exact character match   ${exact.toLocaleString()} (${exactPct.toFixed(2)}%)`);
console.log(`match after match-fold  ${(exact + foldedExact).toLocaleString()} (${foldPct.toFixed(2)}%)   <- what retrieval actually uses`);
console.log(`+ via ц alternates    ${viaAlternates.toLocaleString()} (${(((exact + foldedExact + viaAlternates) / pairs) * 100).toFixed(2)}% cumulative)   <- what the index achieves`);
console.log(`still different         ${(pairs - exact - foldedExact - viaAlternates).toLocaleString()}`);

console.log('\ntop divergences (expected vs produced at first differing char):');
[...divergence].sort((a, b) => b[1] - a[1]).slice(0, 20)
  .forEach(([cause, n]) => console.log(`  ${String(n).padStart(7)}  ${cause}`));

console.log('\nsample mismatches:');
mismatchSamples.slice(0, 8).forEach((m) => {
  console.log(`  ${m.code}`);
  console.log(`    cyr      ${m.cyr.slice(0, 90)}`);
  console.log(`    expected ${m.expected.slice(0, 90)}`);
  console.log(`    got      ${m.got.slice(0, 90)}`);
});

writeFileSync('docs/eval-translit.json', JSON.stringify({
  pairs, exact, exactPct, foldedExact, foldPct, viaAlternates,
  indexPct: ((exact + foldedExact + viaAlternates) / pairs) * 100,
  divergences: [...divergence].sort((a, b) => b[1] - a[1]).slice(0, 60),
  mismatchSamples,
}, null, 2));
console.log('\nwrote docs/eval-translit.json');
