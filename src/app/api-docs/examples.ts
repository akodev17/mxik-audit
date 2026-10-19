// Request and response samples for /api-docs. Responses use the real field names (the serializers'
// shapes) with placeholder values: ids, codes and counts are illustrations, not data.
import { HEADERS } from '@/lib/api/contract';

const json = (value: unknown): string => JSON.stringify(value, null, 2);
const ID = 'cm1a2b3c4d5e6f7g8h9i0j';
const CLIENT = 'cm0z9y8x7w6v5u4t3s2r1q';
const CODE = '00000000000000000';
const AT = '2026-10-01T09:30:00.000Z';

export function docExamples(base: string, rate: number) {
  return {
    setup: `export BASE="${base}"\nexport KEY="mxk_..."   # Settings → Integrations → API`,
    auth: 'Authorization: Bearer $KEY',
    headers: `HTTP/1.1 200 OK\n${HEADERS.limit}: ${rate}\n${HEADERS.remaining}: ${Math.max(0, rate - 1)}`,
    check: [
      'curl -X POST "$BASE/api/v1/check" \\',
      '  -H "Authorization: Bearer $KEY" \\',
      '  -H "Content-Type: application/json" \\',
      `  -H "${HEADERS.idempotencyKey}: $(uuidgen)" \\`,
      `  -d '{"items": [{"name": "Sut 3.2% 1 L", "barcode": "4780000000000", "unit": "dona"}]}'`,
    ].join('\n'),
    checkResponse: json({
      results: [{
        name: 'Sut 3.2% 1 L',
        markingRequired: false,
        findings: [{
          type: 'MISSING', severity: 'high', suggestedMxik: CODE, confidence: 0.91, reason: '…',
          alternatives: [{ code: CODE, name: '…', confidence: 0.84 }],
        }],
      }],
    }),
    list: 'curl "$BASE/api/v1/catalogs?limit=50" \\\n  -H "Authorization: Bearer $KEY"\n\n# next page\ncurl "$BASE/api/v1/catalogs?limit=50&cursor=$NEXT_CURSOR" \\\n  -H "Authorization: Bearer $KEY"',
    listResponse: json({
      catalogs: [{ id: ID, filename: 'katalog.xlsx', clientId: CLIENT, createdAt: AT, status: 'ready', rows: 1200, progress: { done: 1200, total: 1200 } }],
      nextCursor: ID,
    }),
    upload: [
      'curl -X POST "$BASE/api/v1/catalogs" \\',
      '  -H "Authorization: Bearer $KEY" \\',
      `  -H "${HEADERS.idempotencyKey}: $(uuidgen)" \\`,
      '  -F "file=@katalog.xlsx" \\',
      `  -F "clientId=${CLIENT}"`,
    ].join('\n'),
    uploadResponse: json({ id: ID, status: 'analyzing', rows: 1200, clientId: CLIENT }),
    report: `curl "$BASE/api/v1/catalogs/${ID}/report?limit=200" \\\n  -H "Authorization: Bearer $KEY"`,
    reportResponse: json({
      id: ID, filename: 'katalog.xlsx', clientId: CLIENT, createdAt: AT, status: 'ready', rows: 1200, progress: { done: 1200, total: 1200 },
      error: null,
      summary: { MISSING: 12, MISMATCH: 4 },
      findings: [{
        id: 'cm9f8e7d6c5b4a3z2y1x0w', row: 7, name: 'Sut 3.2% 1 L', barcode: '4780000000000', unit: 'dona', currentMxik: null,
        type: 'MISSING', severity: 'high', suggestedMxik: CODE, confidence: 0.91, reason: '…',
        decision: 'pending', decisionSource: null, chosenMxik: null,
      }],
      nextCursor: null,
    }),
    error: json({ error: { code: 'rate_limited', message: `Too many requests: at most ${rate} per minute for this key. Try again in 12 s.` } }),
  };
}
