'use client';

import { useI18n } from '@/lib/locale-client';
import { IconCheck, IconDownload } from '@/ui/icons';

/** The sample catalogue the landing page offers too (public/demo). */
export const SAMPLE_FILE = '/demo/namuna-katalog.xlsx';

/** Beside the dropzone: what a file needs, and a sample to copy the columns from. */
export function UploadTips() {
  const { ta } = useI18n();
  const f = ta.importX.flow;
  return (
    <aside aria-labelledby="upload-tips" className="rounded-lg border border-line bg-raised p-4 sm:p-5">
      <h2 id="upload-tips" className="text-data font-semibold">{f.tipsTitle}</h2>
      <ul className="mt-3 space-y-2.5 text-small text-muted">
        {f.tips.map((tip) => (
          <li key={tip} className="flex items-start gap-2">
            <IconCheck size={14} className="mt-0.5 shrink-0 text-good-ink" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-line pt-4">
        <a href={SAMPLE_FILE} download className="inline-flex items-center gap-1.5 rounded-sm text-small font-medium text-brand-ink hover:underline">
          <IconDownload size={14} />{f.sample}
        </a>
        <p className="mt-1 text-micro text-muted">{f.sampleHint}</p>
      </div>
    </aside>
  );
}
