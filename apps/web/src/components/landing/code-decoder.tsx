import { SAMPLE_REPORT, type SampleCatalogRow } from './sample-report.generated';
import { CodeBlocks } from './code-blocks';
import { BLOCKS, firstBlockDivergence, splitBlocks } from './mxik-code';
import { sentenceCase } from './workspace-model';

// First mismatch in the sample whose two codes are both fully known.
function focusRow(): { row: SampleCatalogRow; own: string; suggested: string } | null {
  const { catalog, codes } = SAMPLE_REPORT;
  for (const row of catalog) {
    const f = row.findings.find((x) => x.type === 'MISMATCH');
    if (!f || !row.code || !f.suggestedMxik) continue;
    if (codes[row.code]?.path.length === 4 && codes[f.suggestedMxik]?.path.length === 4
      && firstBlockDivergence(row.code, f.suggestedMxik) > 0) {
      return { row, own: row.code, suggested: f.suggestedMxik };
    }
  }
  return null;
}

// Catalog code and suggested code read level by level, the split marked.
export function CodeDecoder() {
  const focus = focusRow();
  if (!focus) return null;
  const { row, own, suggested } = focus;
  const a = SAMPLE_REPORT.codes[own];
  const b = SAMPLE_REPORT.codes[suggested];
  const ba = splitBlocks(own);
  const bb = splitBlocks(suggested);
  if (!a || !b || !ba || !bb) return null;
  const split = firstBlockDivergence(own, suggested);
  const name = (c: typeof a, i: number) =>
    i < 4 ? sentenceCase(c.path[i] ?? '-') : (c.brand ?? (c.isBase ? 'umumiy kod' : '-'));

  return (
    <figure className="border border-lp-line bg-lp-surface p-5 sm:p-8">
      <figcaption className="text-[16px] text-lp-muted">
        Namunadan <span className="num">{row.row}</span>-qator: <span className="font-medium text-lp-ink">{row.name}</span>
      </figcaption>

      <div className="mt-6 space-y-6">
        <div>
          <p className="text-[15px] font-medium">Katalogdagi kod</p>
          <div className="mt-2"><CodeBlocks code={own} from={split} tone="warn" size="lg" labels /></div>
        </div>
        <div>
          <p className="text-[15px] font-medium">Taklif etilgan kod</p>
          <div className="mt-2"><CodeBlocks code={suggested} from={split} tone="ok" size="lg" labels /></div>
        </div>
      </div>

      <p className="mt-6 max-w-[62ch] text-[17px]">
        Guruh bir xil, lekin <strong>{BLOCKS[split]?.label} darajasida ajraladi</strong>: katalogdagi kod
        «{name(a, split)}»ga tegishli, tovar esa «{name(b, split)}».
      </p>

      <dl className="mt-6 border-t border-lp-line">
        {BLOCKS.map((block, i) => (
          <div key={block.label} className={`grid grid-cols-1 gap-x-6 gap-y-1 border-b border-lp-line py-3 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] ${i === split ? 'bg-lp-warn-fill' : ''}`}>
            <dt className="text-[15px] font-medium capitalize sm:pl-2">
              {block.label}
              {i === split ? <span className="block text-[14px] font-normal normal-case">shu yerda ajraladi</span> : null}
            </dt>
            <dd className="text-[16px]">
              <span className="num mr-2 font-medium">{ba[i]}</span>{name(a, i)}
            </dd>
            <dd className="text-[16px]">
              {i < split ? (
                <span className="text-lp-muted">bir xil</span>
              ) : (
                <><span className="num mr-2 font-medium">{bb[i]}</span>{name(b, i)}</>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </figure>
  );
}
