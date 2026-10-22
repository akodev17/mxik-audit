// Scores the audit of the demo template against what each demo row was built to
// be (labels in prisma/demo-catalog.json): per-check precision and recall, and
// whether the suggested code is the right one. The demo is invented data, so
// these numbers describe the checks' behaviour, not real-world accuracy.
// Run: npm run demo:quality   (after npm run seed:demo)
import '@tasnivo/domain/load-env';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { db } from '@tasnivo/db';

const Label = z.object({
  intent: z.enum(['clean', 'missing', 'not_found', 'wrong_code', 'unit_conflict']),
  correctCode: z.string(),
}).nullable();
const Fixture = z.object({ labels: z.array(Label) });

/** The finding type each intent should produce; clean rows should produce none. */
const EXPECTED = { missing: 'MISSING', not_found: 'NOT_FOUND', wrong_code: 'MISMATCH', unit_conflict: 'UNIT_CONFLICT' } as const;

try {
  const { labels } = Fixture.parse(JSON.parse(readFileSync('packages/db/prisma/demo-catalog.json', 'utf8')));
  const catalog = await db.catalog.findFirst({
    where: { org: { kind: 'demo_template' }, status: 'ready' },
    orderBy: { createdAt: 'desc' },
    include: { items: { include: { findings: { select: { type: true, suggestedMxik: true } } } } },
  });
  if (!catalog) throw new Error('No demo template. Run `npm run seed:demo` first.');

  const perType = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (type: string, key: 'tp' | 'fp' | 'fn') => {
    const s = perType.get(type) ?? { tp: 0, fp: 0, fn: 0 };
    s[key]++;
    perType.set(type, s);
  };
  let cleanRows = 0;
  let cleanFlagged = 0;
  let suggested = 0;
  let suggestedRight = 0;
  const falseAlarms: string[] = [];

  for (const item of catalog.items) {
    const label = labels[item.rowIndex];
    if (!label) continue;
    const types = new Set(item.findings.map((f) => f.type));
    const expected = label.intent === 'clean' ? null : EXPECTED[label.intent];
    if (label.intent === 'clean') {
      cleanRows++;
      if (types.size > 0) cleanFlagged++;
    }
    for (const t of types) {
      if (t === expected) bump(t, 'tp');
      else {
        bump(t, 'fp');
        falseAlarms.push(`${t.padEnd(13)} ${item.rawName.slice(0, 50)}  (built as ${label.intent})`);
      }
    }
    if (expected && !types.has(expected)) bump(expected, 'fn');
    // Did the suggestion name the right code, where a new code was needed?
    if (label.intent === 'missing' || label.intent === 'not_found' || label.intent === 'wrong_code') {
      const finding = item.findings.find((f) => f.type === expected);
      if (finding?.suggestedMxik) {
        suggested++;
        if (finding.suggestedMxik === label.correctCode) suggestedRight++;
      }
    }
  }

  const pct = (a: number, b: number): string => (b === 0 ? '  -  ' : `${((a / b) * 100).toFixed(0).padStart(3)}%`);
  console.log(`demo template ${catalog.filename}: ${catalog.items.length} rows, ${labels.filter(Boolean).length} labelled`);
  console.log('');
  console.log('check          flagged  correct  precision  recall');
  for (const [type, s] of [...perType].sort()) {
    console.log(`${type.padEnd(14)} ${String(s.tp + s.fp).padStart(7)}  ${String(s.tp).padStart(7)}  ${pct(s.tp, s.tp + s.fp).padStart(9)}  ${pct(s.tp, s.tp + s.fn).padStart(6)}`);
  }
  console.log('');
  console.log(`clean rows flagged anyway   ${cleanFlagged}/${cleanRows} (${pct(cleanFlagged, cleanRows).trim()})`);
  console.log(`suggestion = intended code  ${suggestedRight}/${suggested} (${pct(suggestedRight, suggested).trim()}) on missing / not-found / wrong-code rows`);
  if (falseAlarms.length > 0) {
    console.log('');
    console.log('false alarms:');
    for (const line of falseAlarms) console.log(`  ${line}`);
  }
} finally {
  await db.$disconnect();
}
