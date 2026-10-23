// The wizard's preview on the real files: rows, guessed mapping, headers, diagnostics.
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { verified, uniq } from './lib.mjs';
const U = await verified(`a5-files-${uniq()}@example.test`, 'Files probe');
await U.call('GET', '/api/shell');
const dirs = ['../../../tmp/found-catalogs', 'apps/web/e2e/fixtures'];
const files = dirs.flatMap((d) => { try { return readdirSync(d).filter((f) => /\.(xlsx|xls|csv|pdf|txt)$/i.test(f)).map((f) => join(d, f)); } catch { return []; } });
for (const f of files) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(f)]), basename(f));
  const r = await U.call('POST', '/api/catalogs/preview', fd);
  const p = r.data?.preview;
  if (!p) { console.log(basename(f), '->', r.status, JSON.stringify(r.data).slice(0, 150)); continue; }
  const m = p.mapping; const h = p.headers;
  const col = (i) => (i >= 0 ? `${i}:${(h[i] ?? '').slice(0, 22)}` : '-');
  console.log(basename(f), `rows=${p.rows}`, `name=${col(m.name)} mxik=${col(m.mxik)} barcode=${col(m.barcode)} unit=${col(m.unit)} price=${col(m.price)}`, p.diagnostics ? `diag=${JSON.stringify(p.diagnostics).slice(0, 120)}` : '');
  await U.call('DELETE', `/api/catalogs/${p.catalogId}/preview`);
}
