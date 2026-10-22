import Link from 'next/link';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { workspaceHref, type QueueRow } from '@/lib/queue';
import { Badge, StatusChip, StatusIcon } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { IconComment } from '@/ui/icons';
import { suggestionLabel, typeLabels, typeTone } from '@/ui/labels';
import { Table, Td, Th } from '@/ui/table';

/** Pending risky findings: a table from the small breakpoint up, stacked cards on a phone. */
export async function QueueList({ rows }: { rows: QueueRow[] }) {
  const { locale, t, ta } = await getI18n();
  const q = ta.firmX.queue;
  const labels = typeLabels(t);

  const issue = (r: QueueRow) => {
    const tone = typeTone(r.type, r.severity);
    return (
      <span className="flex flex-col items-start gap-0.5">
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{labels[r.type] ?? r.type}</StatusChip>
        <span className="text-micro text-muted">{r.severity === 'high' ? q.sevHigh : q.sevMedium}</span>
      </span>
    );
  };
  const suggestion = (r: QueueRow) => {
    // A unit finding keeps its code: the fix is the unit, so say that instead of repeating the code.
    if (r.type === 'UNIT_CONFLICT') {
      const fix = r.unitFix;
      const text = !fix ? q.unitCheck : fix.current ? q.unitFix(fix.current, fix.expected) : q.unitOnly(fix.expected);
      return <span className="text-small font-medium">{text}</span>;
    }
    if (!r.suggestedMxik) return <span className="text-small text-muted">{q.noSuggestion}</span>;
    const label = suggestionLabel(t, ta, { confidence: r.confidence, stage: r.stage });
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <CodeChip code={r.suggestedMxik} />
        {label ? <Badge tone={label.tone}>{label.label}</Badge> : null}
      </span>
    );
  };
  const marks = (r: QueueRow) => (
    <>
      {r.askClient ? <Badge tone="info">{q.askClient}</Badge> : null}
      {r.comments > 0 ? (
        <span className="inline-flex items-center gap-1 text-micro text-muted" title={q.comments(r.comments)}>
          <IconComment size={12} /><span aria-hidden>{fmtNumber(locale, r.comments)}</span><span className="sr-only">{q.comments(r.comments)}</span>
        </span>
      ) : null}
    </>
  );
  const where = (r: QueueRow) => (
    <span className="text-small text-muted">
      <Link href={`/clients/${r.clientId}`} className="hover:text-fg hover:underline">{r.clientName}</Link>
      {' · '}<span className="break-all">{r.catalogName}</span>
      {' · '}<span className="whitespace-nowrap">{q.rowNo(r.rowIndex + 1)}</span>
    </span>
  );

  // Each row's pieces are built once and placed in both layouts: the payload then carries them once
  // (React sends a repeated element as a reference), not once per layout.
  const items = rows.map((r) => ({
    r,
    unit: r.unit ? <span className="ml-1.5 text-small font-normal text-muted">{r.unit}</span> : null,
    where: where(r),
    marks: marks(r),
    issue: issue(r),
    current: r.existingMxik ? <CodeChip code={r.existingMxik} /> : null,
    suggestion: suggestion(r),
    open: <>{q.open}<span className="sr-only">: {q.openLabel(r.clientName, r.rowIndex + 1)}</span></>,
  }));

  return (
    <>
      <div className="hidden md:block">
        <Table label={q.title}>
          <thead>
            <tr>
              <Th>{q.colProduct}</Th>
              <Th>{q.colIssue}</Th>
              <Th>{q.colCurrent}</Th>
              <Th>{q.colSuggestion}</Th>
              <Th><span className="sr-only">{q.open}</span></Th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ r, ...x }) => (
              <tr key={r.findingId}>
                <Td className="min-w-[14rem] max-w-xs">
                  <Link href={workspaceHref(r)} className="block truncate font-medium hover:text-brand-ink hover:underline" title={r.rawName}>{r.rawName}{x.unit}</Link>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">{x.where}{x.marks}</span>
                </Td>
                <Td>{x.issue}</Td>
                <Td>{x.current ?? <span className="text-small text-muted">{q.noCode}</span>}</Td>
                <Td>{x.suggestion}</Td>
                <Td className="text-right">
                  <ButtonLink href={workspaceHref(r)} size="sm" variant="secondary">{x.open}</ButtonLink>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {items.map(({ r, ...x }) => (
          <li key={r.findingId} className="relative rounded-ctl border border-line bg-raised p-3">
            <p className="font-medium [overflow-wrap:anywhere]">{r.rawName}{x.unit}</p>
            <p className="mt-0.5">{x.where}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">{x.issue}{x.marks}</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-small">
              <dt className="text-muted">{q.colCurrent}</dt>
              <dd className="min-w-0">{x.current ?? <span className="text-muted">{q.noCode}</span>}</dd>
              <dt className="text-muted">{q.colSuggestion}</dt>
              <dd className="min-w-0">{x.suggestion}</dd>
            </dl>
            <ButtonLink href={workspaceHref(r)} size="sm" variant="secondary" className="mt-3 w-full">{x.open}</ButtonLink>
          </li>
        ))}
      </ul>
    </>
  );
}
