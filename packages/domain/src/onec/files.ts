// A plan's included records as the file of each format. Pure apart from exceljs; the caller stores
// the bytes on the onec_export row.
import { accounting } from '@tasnivo/contracts';
import { baseName } from '../export-filename.js';
import {
  buildBankExchange, EXCHANGE_CONTENT_TYPE, EXCHANGE_FILENAME, type BankKeys, type ExchangeDocument, type ExchangeParty,
} from './bank-exchange.js';
import { fromMicros, sum, toMicros } from './decimal.js';
import { normalizeName } from './normalize.js';
import type { Included, OneCFormat, Plan, PlanBatch } from './plan.js';
import {
  buildCounterpartiesXlsx, buildNomenclatureXlsx, buildReceiptXlsx, XLSX_CONTENT_TYPE, type CounterpartyRow, type NomenclatureRow, type ReceiptLine,
} from './sheets.js';

export type FileSettings = {
  bankKeys: BankKeys;
  /** The statement owner's name when the statement does not print it: the client's, else the org's. */
  ownerName: string;
  /** The batch's own file name, for the download's name. */
  filename: string | null;
  /** Whether every record of the statement is in the file (only then are the balances written). */
  wholeStatement: boolean;
  now: Date;
};

export type BuiltFile = { bytes: Buffer; filename: string; contentType: string };

/** A file-name part: letters (any script), digits, dots and dashes; the download header carries UTF-8 with an ASCII fallback. */
const safe = (text: string): string => text.normalize('NFC').replace(/[^\p{L}\p{N}.-]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

function bankFile(batch: PlanBatch, rows: Included[], s: FileSettings): BuiltFile {
  const meta = accounting.BankStatementMeta.partial().safeParse(batch.meta);
  const m = meta.success ? meta.data : {};
  const txs = rows.flatMap((r) => (r.kind === 'bank_statement' ? [{ t: r.payload, rowIndex: r.record.rowIndex }] : []))
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || a.rowIndex - b.rowIndex);
  const account = m.account ?? txs.find((x) => x.t.ourAccount)?.t.ourAccount ?? '';
  const dates = txs.map((x) => x.t.date).sort();
  const owner = (ownAccount: string | null): ExchangeParty => ({
    name: m.ownerName ?? s.ownerName, inn: m.ownerInn ?? null, account: ownAccount ?? account, bankName: m.bankName ?? null, mfo: m.mfo ?? null,
  });
  const documents: ExchangeDocument[] = txs.map(({ t, rowIndex }) => ({
    number: t.docNumber ?? t.reference ?? String(rowIndex + 1),
    date: t.date,
    amount: t.amount,
    direction: t.direction,
    owner: owner(t.ourAccount),
    counterparty: { name: t.counterparty.name, inn: t.counterparty.inn, account: t.counterparty.account, bankName: null, mfo: t.counterparty.mfo },
    purpose: t.purpose,
    valueDate: t.valueDate,
  }));
  const bytes = buildBankExchange({
    account,
    periodFrom: m.periodFrom ?? dates[0] ?? s.now.toISOString().slice(0, 10),
    periodTo: m.periodTo ?? dates.at(-1) ?? s.now.toISOString().slice(0, 10),
    openingBalance: s.wholeStatement ? m.openingBalance ?? null : null,
    closingBalance: s.wholeStatement ? m.closingBalance ?? null : null,
    documents,
    bankKeys: s.bankKeys,
    sender: 'Tasnivo',
    receiver: '1С:Бухгалтерия для Узбекистана',
    createdAt: s.now,
  });
  return { bytes, filename: EXCHANGE_FILENAME, contentType: EXCHANGE_CONTENT_TYPE };
}

/** The product a line resolves to: the reviewer's decided record wins over what the invoice printed. */
function productOf(r: Included): NomenclatureRow {
  if (r.kind === 'product_catalog') {
    const p = r.payload;
    return { name: p.name, mxik: p.mxik, packageCode: p.packageCode, unit: p.unit, barcode: p.barcode, article: p.article ?? null };
  }
  if (r.kind === 'didox_invoice') {
    const l = r.payload;
    const p = l.resolved;
    return {
      name: p?.name || l.name, mxik: p?.mxik ?? l.mxik, packageCode: p?.packageCode ?? l.packageCode, unit: p?.unit ?? l.unit,
      barcode: p?.barcode ?? l.barcode, article: p?.article ?? null,
    };
  }
  return { name: '', mxik: null, packageCode: null, unit: null, barcode: null, article: null };
}

async function receiptFile(batch: PlanBatch, rows: Included[], s: FileSettings): Promise<BuiltFile> {
  const meta = accounting.IncomingInvoiceMeta.parse(batch.meta);
  const lines: ReceiptLine[] = rows.flatMap((r) => (r.kind === 'didox_invoice' ? [r] : []))
    .sort((a, b) => a.payload.lineNo - b.payload.lineNo)
    .map((r) => {
      const l = r.payload;
      const p = productOf(r);
      return {
        lineNo: l.lineNo, name: p.name, mxik: p.mxik, packageCode: p.packageCode, unit: p.unit, quantity: l.quantity, price: l.price,
        amount: l.amount, vatRate: l.vatRate, vatAmount: l.vatAmount, total: l.total,
      };
    });
  const amount = sum(lines.map((l) => l.amount));
  const vat = sum(lines.map((l) => l.vatAmount));
  const total = sum(lines.map((l) => l.total ?? fromMicros((toMicros(l.amount) ?? 0n) + (toMicros(l.vatAmount) ?? 0n))));
  const bytes = await buildReceiptXlsx([{
    number: meta.number, date: meta.date, contractNumber: meta.contractNumber, contractDate: meta.contractDate,
    seller: { name: meta.seller.name, inn: meta.seller.inn }, buyer: { name: meta.buyer.name, inn: meta.buyer.inn }, currency: meta.currency,
    lines, totals: { amount: fromMicros(amount), vat: lines.some((l) => l.vatAmount !== null) ? fromMicros(vat) : null, total: fromMicros(total) },
  }], s.now);
  return { bytes, filename: `postuplenie-${safe(meta.number) || 'schet'}-${meta.date}.xlsx`, contentType: XLSX_CONTENT_TYPE };
}

function counterpartyRows(batch: PlanBatch, rows: Included[]): CounterpartyRow[] {
  if (batch.kind === 'didox_invoice') {
    const meta = accounting.IncomingInvoiceMeta.safeParse(batch.meta);
    return meta.success ? [{ name: meta.data.seller.name, inn: meta.data.seller.inn, account: meta.data.seller.account, mfo: meta.data.seller.mfo }] : [];
  }
  const seen = new Set<string>();
  const out: CounterpartyRow[] = [];
  for (const r of rows) {
    if (r.kind !== 'bank_statement') continue;
    const c = r.payload.counterparty;
    const key = c.inn ? `inn:${c.inn}` : c.account ? `acc:${c.account}` : `name:${normalizeName(c.name)}`;
    if (key === 'name:' || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: c.name, inn: c.inn, account: c.account, mfo: c.mfo });
  }
  return out;
}

export async function buildFile(batch: PlanBatch, plan: Plan, format: OneCFormat, s: FileSettings): Promise<BuiltFile> {
  const base = safe(baseName(s.filename ?? '')) || batch.id.slice(-8);
  switch (format) {
    case 'bank_exchange_1_02':
      return bankFile(batch, plan.included, s);
    case 'receipt_xlsx':
      return receiptFile(batch, plan.included, s);
    case 'nomenclature_xlsx':
      return { bytes: await buildNomenclatureXlsx(plan.included.map(productOf), s.now), filename: `${base}-nomenklatura.xlsx`, contentType: XLSX_CONTENT_TYPE };
    case 'counterparties_xlsx':
      return { bytes: await buildCounterpartiesXlsx(counterpartyRows(batch, plan.included), s.now), filename: `${base}-kontragenty.xlsx`, contentType: XLSX_CONTENT_TYPE };
    default:
      throw new Error(`no file for format ${format}`);
  }
}
