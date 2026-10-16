// Client-ready PDF of a report, under the firm's own name and logo. pdfkit
// draws it directly (no browser); DejaVu covers Uzbek ʻ and Cyrillic names.
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { dict, type Dict, type Locale } from '../i18n.js';
import type { PdfRow, ReportPdfData } from './report-data.js';

const FONT_DIR = join(process.cwd(), 'node_modules', 'dejavu-fonts-ttf', 'ttf');
const MARGIN = 40;
const FOOTER = 46;
const INK = '#1c1c1c';
const SOFT = '#555555';
const RULE = '#cfcfcf';

type Text = ReturnType<typeof pdfTexts>;

function pdfTexts(t: Dict) {
  return {
    t,
    columns: [
      { key: 'n', title: '#', width: 30 },
      { key: 'product', title: t.reviewProduct, width: 170 },
      { key: 'type', title: t.reportFilterType, width: 80 },
      { key: 'current', title: t.reviewCurrentCode, width: 172 },
      { key: 'suggested', title: t.reviewSuggested, width: 172 },
      { key: 'status', title: t.pdfStatus, width: 138 },
    ] as const,
    typeText: { MISSING: t.typeMissing, NOT_FOUND: t.typeNotFound, MISMATCH: t.typeMismatch, UNIT_CONFLICT: t.typeUnitConflict } as Record<string, string>,
    decisionText: { pending: t.reviewPending, accepted: t.reviewAccepted, rejected: t.reviewRejected } as const,
  };
}

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const codeText = (c: { code: string; name: string | null } | null, empty: string, unknown: string): string =>
  (c ? `${c.code}\n${clip(c.name ?? unknown, 110)}` : empty);

function cells(row: PdfRow, txt: Text): string[] {
  const { t, decisionText: DECISION_TEXT, typeText: TYPE_TEXT } = txt;
  const status = row.chosen
    ? `${DECISION_TEXT[row.decision]}: ${codeText(row.chosen, '', t.codeUnknown)}`
    : DECISION_TEXT[row.decision];
  return [
    String(row.rowIndex + 1),
    clip(row.product, 160),
    TYPE_TEXT[row.type] ?? row.type,
    codeText(row.current, t.reviewNoCode, t.codeUnknown),
    codeText(row.suggested, '—', t.codeUnknown),
    status,
  ];
}

export async function buildReportPdf(data: ReportPdfData, locale: Locale = 'uz'): Promise<Buffer> {
  const txt = pdfTexts(dict(locale));
  const { t, columns: COLUMNS, typeText: TYPE_TEXT } = txt;
  const date = (d: Date): string => d.toLocaleDateString(locale === 'ru' ? 'ru-RU' : 'uz-UZ');
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

  // ------------------------------------------------------------ letterhead
  let y = MARGIN;
  if (data.logo) {
    try {
      doc.image(data.logo.data, MARGIN, y, { fit: [140, 48] });
    } catch {
      // A logo pdfkit cannot read is skipped, not fatal.
    }
  }
  doc.font('bold').fontSize(13).fillColor(INK).text(data.firmName, MARGIN, y + 14, { width, align: 'right' });
  y += 64;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).strokeColor(RULE).lineWidth(0.7).stroke();

  // ---------------------------------------------------------------- summary
  doc.font('bold').fontSize(18).fillColor(INK).text(t.pdfTitle, MARGIN, y + 14);
  doc.font('body').fontSize(10).fillColor(SOFT);
  const meta = [
    `${t.clientLabel}: ${data.clientName}`,
    `${t.tgFile}: ${data.filename}`,
    `${t.pdfDate}: ${date(data.generatedAt)}`,
    `${t.pdfClassifier}: ${data.classifierDate ? date(data.classifierDate) : '—'}`,
  ];
  doc.text(meta.join('   ·   '), MARGIN, doc.y + 6, { width });

  doc.font('bold').fontSize(13).fillColor(data.riskyRows > 0 ? '#9b1c1c' : '#1d6b3a')
    .text(data.riskyRows > 0 ? t.reportHeadline(data.riskyRows, data.totalRows) : t.reportClean(data.totalRows), MARGIN, doc.y + 12, { width });
  const parts = [
    ...data.byType.map((b) => `${TYPE_TEXT[b.type] ?? b.type}: ${b.count}`),
    `${t.markingBadge}: ${data.markingRows}`,
  ];
  doc.font('body').fontSize(10).fillColor(INK).text(parts.join('   ·   '), MARGIN, doc.y + 4, { width });

  // ------------------------------------------------------------------ table
  const header = (): void => {
    let x = MARGIN;
    const top = doc.y;
    doc.rect(MARGIN, top, width, 18).fill('#f1f1ef');
    doc.font('bold').fontSize(8.5).fillColor(INK);
    for (const col of COLUMNS) {
      doc.text(col.title, x + 3, top + 5, { width: col.width - 6, lineBreak: false });
      x += col.width;
    }
    doc.y = top + 18;
  };

  if (data.rows.length > 0) {
    doc.y += 14;
    header();
    doc.font('body').fontSize(8);
    for (const row of data.rows) {
      const texts = cells(row, txt);
      const height = Math.max(...texts.map((text, i) => doc.heightOfString(text, { width: (COLUMNS[i]?.width ?? 0) - 6 }))) + 8;
      if (doc.y + height > bottom()) {
        doc.addPage();
        header();
        doc.font('body').fontSize(8);
      }
      const top = doc.y;
      let x = MARGIN;
      texts.forEach((text, i) => {
        doc.fillColor(i === 0 ? SOFT : INK).text(text, x + 3, top + 4, { width: (COLUMNS[i]?.width ?? 0) - 6 });
        x += COLUMNS[i]?.width ?? 0;
      });
      doc.moveTo(MARGIN, top + height).lineTo(MARGIN + width, top + height).strokeColor(RULE).lineWidth(0.4).stroke();
      doc.y = top + height;
    }
    if (data.truncated) {
      doc.font('body').fontSize(9).fillColor(SOFT).text(t.pdfTruncated(data.rows.length), MARGIN, doc.y + 8, { width });
    }
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
      .text(t.pdfDisclaimer, MARGIN, footerY, { width: width - 70 })
      .text(t.pdfPage(i + 1, range.count), MARGIN + width - 60, footerY, { width: 60, align: 'right' });
    doc.page.margins.bottom = margin;
  }

  doc.end();
  return done;
}
