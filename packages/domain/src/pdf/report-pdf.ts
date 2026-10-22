// Report PDF under the firm's own name and logo, internal or client-facing.
// pdfkit draws it directly (no browser); DejaVu covers Uzbek ʻ and Cyrillic.
// It keeps apart what the system detected, what it suggested, what people
// decided, what is still open and what the data did not allow to check.
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { restrictionDate } from '@tasnivo/core/audit/checks';
import { typeLabels } from '@tasnivo/i18n/type-labels';
import { decisionSourceLabel } from '../decision-source.js';
import { fmtDate } from '@tasnivo/i18n/format';
import { dict, type Locale } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { degradedNotes } from '../pipeline-meta.js';
import type { PdfRow, ReportPdfData } from './report-data.js';

const FONT_DIR = join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const MARGIN = 40;
const FOOTER = 46;
const INK = '#1c1c1c';
const SOFT = '#555555';
const RULE = '#cfcfcf';
const RISK = '#9b1c1c';
const CLEAN = '#1d6b3a';

export type PdfAudience = 'internal' | 'client';

type Column = { title: string; width: number };
type Texts = ReturnType<typeof texts>;

function texts(locale: Locale, audience: PdfAudience) {
  const t = dict(locale);
  const ta = appDict(locale);
  const p = ta.importX.pdf;
  return {
    t, ta, p, audience,
    types: typeLabels(t),
    decisionText: { pending: t.reviewPending, accepted: t.reviewAccepted, rejected: t.reviewRejected } as const,
    date: (d: Date): string => fmtDate(locale, d),
  };
}

/** The finding type, and for RESTRICTED the date EHF stops accepting the code. */
const typeText = (row: PdfRow, x: Texts): string => {
  const label = x.types[row.type] ?? row.type;
  return row.restrictedFrom ? `${label}
${x.ta.importX.exp.restrictedFrom(restrictionDate(row.restrictedFrom))}` : label;
};

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const codeText = (c: { code: string; name: string | null } | null, empty: string, unknown: string): string =>
  (c ? `${c.code}\n${clip(c.name ?? unknown, 110)}` : empty);

function openColumns(x: Texts): Column[] {
  const { t } = x;
  return [
    { title: '#', width: 30 }, { title: t.reviewProduct, width: 200 }, { title: t.reportFilterType, width: 100 },
    { title: t.reviewCurrentCode, width: 216 }, { title: t.reviewSuggested, width: 216 },
  ];
}

function decidedColumns(x: Texts): Column[] {
  const { t, p } = x;
  return [
    { title: '#', width: 30 }, { title: t.reviewProduct, width: 170 }, { title: t.reportFilterType, width: 90 },
    { title: t.reviewCurrentCode, width: 180 }, { title: p.colDecision, width: 180 }, { title: x.ta.importX.diff.decidedBy, width: 112 },
  ];
}

function who(row: PdfRow, x: Texts): string {
  if (row.automatic) {
    // Carried and auto-accepted decisions name their source; the client copy names no staff.
    const source = row.source ? decisionSourceLabel(row.source, x.ta) : x.p.byAuto;
    return x.audience === 'internal' && row.decidedBy ? `${source}\n${row.decidedBy}` : source;
  }
  return x.audience === 'internal' && row.decidedBy ? row.decidedBy : x.p.byPerson;
}

function openCells(row: PdfRow, x: Texts): string[] {
  const { t } = x;
  return [
    String(row.rowIndex + 1), clip(row.product, 160), typeText(row, x),
    codeText(row.current, t.reviewNoCode, t.codeUnknown), codeText(row.suggested, '—', t.codeUnknown),
  ];
}

function decidedCells(row: PdfRow, x: Texts): string[] {
  const { t, decisionText } = x;
  const outcome = row.decision === 'accepted'
    ? `${decisionText.accepted}: ${codeText(row.chosen ?? row.suggested, '—', t.codeUnknown)}`
    : decisionText[row.decision];
  return [
    String(row.rowIndex + 1), clip(row.product, 160), typeText(row, x),
    codeText(row.current, t.reviewNoCode, t.codeUnknown), outcome, who(row, x),
  ];
}

/** Lines for the data-limitations section; never empty. */
function limitationLines(data: ReportPdfData, x: Texts): string[] {
  const { p } = x;
  const lines: string[] = [];
  if (data.limits) {
    if (data.limits.notRead > 0) lines.push(p.limits.notRead(data.limits.notRead, data.limits.totalSeen));
    if (data.limits.dropped > 0) lines.push(p.limits.dropped(data.limits.dropped));
    if (data.limits.badCodes > 0) lines.push(p.limits.badCodes(data.limits.badCodes));
  }
  if (data.pipeline) lines.push(...degradedNotes(data.pipeline, x.ta));
  return lines.length > 0 ? lines : [p.limits.none];
}

export async function buildReportPdf(data: ReportPdfData, locale: Locale = 'uz', audience: PdfAudience = 'client'): Promise<Buffer> {
  const x = texts(locale, audience);
  const { t, p } = x;
  const doc = new PDFDocument({
    size: 'A4', layout: 'landscape', bufferPages: true,
    margins: { top: MARGIN, bottom: MARGIN + FOOTER, left: MARGIN, right: MARGIN },
    info: { Title: `${t.pdfTitle} — ${data.clientName}`, Author: data.firmName },
  });
  doc.registerFont('body', join(FONT_DIR, 'DejaVuSansCondensed.ttf'));
  doc.registerFont('bold', join(FONT_DIR, 'DejaVuSansCondensed-Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const width = doc.page.width - MARGIN * 2;
  const bottom = (): number => doc.page.height - doc.page.margins.bottom;
  const ensure = (height: number): void => { if (doc.y + height > bottom()) doc.addPage(); };

  // ------------------------------------------------------------ letterhead
  let y = MARGIN;
  if (data.logo) {
    try {
      doc.image(data.logo.data, MARGIN, y, { fit: [140, 48] });
    } catch {
      // A logo pdfkit cannot read is skipped, not fatal.
    }
  }
  doc.font('bold').fontSize(13).fillColor(INK).text(data.firmName, MARGIN, y + 6, { width, align: 'right' });
  doc.font('body').fontSize(9).fillColor(SOFT).text(audience === 'internal' ? p.internal : p.forClient, MARGIN, y + 26, { width, align: 'right' });
  y += 64;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(RULE).lineWidth(0.7).stroke();

  // ---------------------------------------------------------------- summary
  doc.font('bold').fontSize(18).fillColor(INK).text(t.pdfTitle, MARGIN, y + 14);
  doc.font('body').fontSize(10).fillColor(SOFT);
  const meta = [`${t.clientLabel}: ${data.clientName}`, `${t.tgFile}: ${data.filename}`, `${t.pdfDate}: ${x.date(data.generatedAt)}`];
  doc.text(meta.join('   ·   '), MARGIN, doc.y + 6, { width });

  const checks = [p.checks.code, p.checks.classifier, p.checks.name, p.checks.unit, ...(data.checks.purchases ? [p.checks.purchases] : []), p.checks.privileges];
  doc.text(`${p.scope(checks.join(', '))} ${data.classifierDate ? p.snapshot(x.date(data.classifierDate)) : p.snapshotUnknown}`, MARGIN, doc.y + 4, { width });

  doc.font('bold').fontSize(13).fillColor(data.riskyRows > 0 ? RISK : CLEAN)
    .text(data.riskyRows > 0 ? p.found(data.riskyRows, data.totalRows) : p.clean(data.totalRows), MARGIN, doc.y + 12, { width });

  // ----------------------------------------------- what is what, separately
  const section = (title: string, lines: string[]): void => {
    ensure(40);
    doc.font('bold').fontSize(10.5).fillColor(INK).text(title, MARGIN, doc.y + 8, { width });
    doc.font('body').fontSize(9.5).fillColor(INK);
    for (const line of lines) doc.text(`• ${line}`, MARGIN + 8, doc.y + 2, { width: width - 8 });
  };
  const typeParts = [...data.byType.map((b) => `${x.types[b.type] ?? b.type}: ${b.count}`), `${t.markingBadge}: ${data.markingRows}`];
  section(p.sections.detected, [typeParts.join('   ·   ')]);
  section(p.sections.suggestions, [p.suggested(data.counts.suggested, data.counts.detected)]);
  section(p.sections.decisions, [p.decided(data.counts.decided, data.counts.automatic)]);
  section(p.sections.unresolved, [
    p.unresolved(data.counts.unresolved),
    ...(data.riskyRows > 0 ? [p.rowsReviewed(data.rowReview.done, data.rowReview.partial, data.rowReview.open)] : []),
  ]);
  section(p.sections.limitations, limitationLines(data, x));

  // ------------------------------------------------------------------ tables
  const table = (title: string, columns: Column[], rows: PdfRow[], cells: (row: PdfRow) => string[]): void => {
    if (rows.length === 0) return;
    const header = (): void => {
      let left = MARGIN;
      const top = doc.y;
      doc.rect(MARGIN, top, width, 18).fill('#f1f1ef');
      doc.font('bold').fontSize(8.5).fillColor(INK);
      for (const col of columns) {
        doc.text(col.title, left + 3, top + 5, { width: col.width - 6, lineBreak: false });
        left += col.width;
      }
      doc.y = top + 18;
    };
    ensure(60);
    doc.font('bold').fontSize(11).fillColor(INK).text(title, MARGIN, doc.y + 14, { width });
    doc.y += 4;
    header();
    doc.font('body').fontSize(8);
    for (const row of rows) {
      const values = cells(row);
      const height = Math.max(...values.map((text, i) => doc.heightOfString(text, { width: (columns[i]?.width ?? 0) - 6 }))) + 8;
      if (doc.y + height > bottom()) {
        doc.addPage();
        header();
        doc.font('body').fontSize(8);
      }
      const top = doc.y;
      let left = MARGIN;
      values.forEach((text, i) => {
        doc.fillColor(i === 0 ? SOFT : INK).text(text, left + 3, top + 4, { width: (columns[i]?.width ?? 0) - 6 });
        left += columns[i]?.width ?? 0;
      });
      doc.moveTo(MARGIN, top + height).lineTo(MARGIN + width, top + height).strokeColor(RULE).lineWidth(0.4).stroke();
      doc.y = top + height;
    }
  };
  table(p.tableUnresolved, openColumns(x), data.rows.filter((r) => r.decision === 'pending'), (r) => openCells(r, x));
  table(p.tableDecided, decidedColumns(x), data.rows.filter((r) => r.decision !== 'pending'), (r) => decidedCells(r, x));
  if (data.truncated) {
    ensure(20);
    doc.font('body').fontSize(9).fillColor(SOFT).text(p.truncated(data.rows.length), MARGIN, doc.y + 8, { width });
  }

  // ----------------------------------------------- footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin would otherwise start a new page.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - MARGIN - FOOTER + 14;
    doc.moveTo(MARGIN, footerY - 6).lineTo(MARGIN + width, footerY - 6).strokeColor(RULE).lineWidth(0.4).stroke();
    doc.font('body').fontSize(7.5).fillColor(SOFT)
      .text(p.disclaimer, MARGIN, footerY, { width: width - 70 })
      .text(t.pdfPage(i + 1, range.count), MARGIN + width - 60, footerY, { width: 60, align: 'right' });
    doc.page.margins.bottom = margin;
  }

  doc.end();
  return done;
}
