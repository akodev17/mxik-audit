'use client';

import { useEffect, useRef } from 'react';
import type { SampleCatalogRow, SampleCode } from '@tasnivo/domain/sample-report.generated';
import { ButtonLink, TextLink } from './button';
import { CodeBlocks } from './code-blocks';
import { firstBlockDivergence } from './mxik-code';
import { TYPE_META, bandOf, readFinding } from './workspace-model';

const MARK = { risk: 'bg-lp-risk', caution: 'bg-lp-warn' } as const;
const BAND_MARK = { high: 'bg-lp-ok', medium: 'bg-lp-warn', low: 'bg-lp-risk' } as const;

// One row's result: what is wrong, the codes side by side, confidence, next step.
export function ScanPanel({
  row,
  codes,
  demoUrl,
  onClose,
}: {
  row: SampleCatalogRow;
  codes: Readonly<Record<string, SampleCode>>;
  demoUrl: string | null;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row.row, onClose]);

  const own = row.code;
  const ownName = own ? codes[own]?.name : undefined;

  return (
    <>
      {/* Backdrop for the phone bottom sheet. */}
      <button
        type="button"
        aria-label="Natijani yopish"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-lp-ink/40 lg:hidden"
      />
      <section
        role="dialog"
        aria-modal="false"
        aria-labelledby="scan-panel-title"
        className={
          'fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-lp border border-lp-line bg-lp-base p-5 shadow-[0_-8px_32px_rgba(21,32,43,0.18)] '
          + 'lg:absolute lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-4 lg:max-h-none lg:w-[400px] lg:rounded-lp lg:p-6 lg:shadow-[0_16px_48px_rgba(21,32,43,0.22)]'
        }
      >
        <div className="flex items-start justify-between gap-4">
          <p className="num text-[15px] text-lp-muted">{row.row}-qator</p>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 rounded-lp px-3 py-1.5 text-[15px] font-medium text-lp-muted hover:bg-lp-surface hover:text-lp-ink"
          >
            Yopish
          </button>
        </div>
        <h3 id="scan-panel-title" ref={heading} tabIndex={-1} className="mt-1 text-[22px] outline-none">
          {row.name}
        </h3>
        <p className="mt-1 text-[15px] text-lp-muted">
          {row.barcode ? <>Shtrix kod <span className="num">{row.barcode}</span>. </> : null}
          Birlik: «{row.unit ?? '-'}»
        </p>

        {row.findings.length === 0 ? (
          <div className="mt-5 border-l-4 border-lp-ok bg-lp-ok-fill p-4">
            <p className="font-bold">Muammo topilmadi</p>
            <p className="mt-1 text-[16px]">
              Kod bor, tasniflagichda bor, tovar nomiga mos, oʻlchov birligi kodga mos.
            </p>
            {own ? (
              <div className="mt-3">
                <CodeBlocks code={own} />
                {ownName ? <p className="mt-1.5 text-[15px] text-lp-muted">{ownName}</p> : null}
              </div>
            ) : null}
          </div>
        ) : (
          row.findings.map((f, i) => {
            const meta = TYPE_META[f.type];
            const reading = readFinding(row, f, codes);
            const split = own && f.suggestedMxik ? firstBlockDivergence(own, f.suggestedMxik) : 0;
            const suggestion = f.suggestedMxik ? codes[f.suggestedMxik] : undefined;
            const band = f.confidence === null ? null : bandOf(f.confidence);
            const tone = meta.tone === 'risk' ? 'risk' : 'warn';
            return (
              <div key={i} className="mt-5 border-t border-lp-line pt-5">
                <p className="flex items-center gap-2 font-bold">
                  <span aria-hidden="true" className={`h-3 w-3 shrink-0 ${MARK[meta.tone]}`} />
                  {meta.label}
                </p>
                <p className="mt-2 text-[16px] font-medium">{reading.what}</p>
                <p className="mt-1 text-[16px] text-lp-muted">{reading.why}</p>

                <dl className="mt-4 space-y-4">
                  <div>
                    <dt className="text-[15px] text-lp-muted">Katalogdagi kod</dt>
                    <dd className="mt-1">
                      {own ? <CodeBlocks code={own} from={f.type === 'UNIT_CONFLICT' ? -1 : split} tone={tone} /> : (
                        <span className="inline-block border border-lp-line border-b-[3px] border-b-lp-risk bg-lp-risk-fill px-2 py-0.5 text-[16px]">
                          boʻsh
                        </span>
                      )}
                    </dd>
                  </div>
                  {f.type === 'UNIT_CONFLICT' ? (
                    <div>
                      <dt className="text-[15px] text-lp-muted">Oʻlchov birligi</dt>
                      <dd className="mt-1 text-[17px]">
                        <span className="bg-lp-warn-fill px-1.5">«{row.unit ?? '-'}»</span> oʻrniga{' '}
                        <span className="bg-lp-ok-fill px-1.5">«{f.requiredUnit ?? '-'}»</span>
                      </dd>
                    </div>
                  ) : (
                    <div>
                      <dt className="text-[15px] text-lp-muted">Taklif etilgan kod</dt>
                      <dd className="mt-1">
                        {f.suggestedMxik ? (
                          <>
                            <CodeBlocks code={f.suggestedMxik} from={own ? split : 0} tone="ok" />
                            {suggestion ? <p className="mt-1.5 text-[15px]">{suggestion.name}</p> : null}
                          </>
                        ) : (
                          <span className="text-[16px] text-lp-muted">Mos kod topilmadi</span>
                        )}
                      </dd>
                    </div>
                  )}
                  {band && f.confidence !== null ? (
                    <div>
                      <dt className="text-[15px] text-lp-muted">Moslik</dt>
                      <dd className="mt-1 flex items-center gap-2 text-[17px]">
                        <span aria-hidden="true" className={`h-3 w-3 ${BAND_MARK[band.key]}`} />
                        <span className="font-bold">{band.label}</span>
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <p className="mt-4 text-[16px]">
                  <span className="font-medium">Keyingi qadam: </span>
                  {reading.next}
                </p>
              </div>
            );
          })
        )}

        <div className="mt-6 border-t border-lp-line pt-5">
          {demoUrl ? (
            <ButtonLink href={demoUrl} className="w-full">Demoda shu qatorni koʻrib chiqish</ButtonLink>
          ) : (
            <TextLink href="#audit" onClick={onClose}>Oʻz faylingizni bepul tekshirtirish</TextLink>
          )}
        </div>
      </section>
    </>
  );
}
