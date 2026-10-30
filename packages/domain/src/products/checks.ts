// The product file checks that need no database: what an Excel cell did to an ИКПУ, barcodes,
// prices and VAT, duplicates within the file, service rows, the package/unit rules over a tasnif
// card, a barcode's tasnif code against the row's code, and the 30-day grace of a changed code.
// Every rule names its item of the research checklist (tmp/real-docs/products/RESEARCH.md §7,
// summarised in docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md "S3 results"). Pure.
import { barcodeIdentity } from '@tasnivo/core/normalize/index';
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { productNameKey } from './keys.js';
import type { TasnifPackage } from './tasnif-client.js';
import { normalizeUnit, SERVICE_UNIT_IDS, UNIT } from './units.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;

// ── ИКПУ cells (§7.1) ──────────────────────────────────────────────────────────────────────

export type IkpuRead =
  | { kind: 'empty' }
  | { kind: 'ok'; code: string }
  /** "4.05001001106E+16": a CSV or a General-formatted cell shows the number, the digits are gone. */
  | { kind: 'scientific'; value: string }
  /** 12–16 digits: the cell was a number and its leading zeros fell off. `restored` is shown, never applied. */
  | { kind: 'leading_zero_lost'; value: string; restored: string }
  | { kind: 'malformed'; value: string };

/**
 * What a file's ИКПУ cell holds. Separators (spaces, dots, dashes) and Excel's text apostrophe are
 * dropped as before (keys.ts mxikOf); a damaged code is reported by its damage and never padded.
 */
export function readIkpu(raw: string | null | undefined): IkpuRead {
  const value = (raw ?? '').trim().replace(/^'/, '');
  if (!value) return { kind: 'empty' };
  if (/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(value)) return { kind: 'scientific', value };
  const digits = value.replace(/[\s.\-–]/g, '');
  if (/^\d{17}$/.test(digits)) return { kind: 'ok', code: digits };
  if (/^\d{12,16}$/.test(digits)) return { kind: 'leading_zero_lost', value, restored: digits.padStart(17, '0') };
  return { kind: 'malformed', value };
}

/** The issue a damaged ИКПУ cell raises (all errors: the row has no usable code until a person fixes it). */
export function ikpuIssue(read: IkpuRead): ValidationIssue | null {
  switch (read.kind) {
    case 'scientific':
      return { code: 'mxik_scientific', severity: 'error', field: 'mxik', params: { value: read.value.slice(0, 40) } };
    case 'leading_zero_lost':
      return { code: 'mxik_leading_zero', severity: 'error', field: 'mxik', params: { value: read.value.slice(0, 40), restored: read.restored } };
    case 'malformed':
      return { code: 'mxik_malformed', severity: 'error', field: 'mxik', params: { value: read.value.slice(0, 40) } };
    default:
      return null;
  }
}

/**
 * A 17-digit code that was a number cell in the .xlsx: Excel keeps 15 significant digits, so the last
 * two digits may already be zeros that were never typed (§7.1, buline.uz "store as text").
 */
export function numericCellIssue(code: string): ValidationIssue {
  return { code: 'mxik_number_cell', severity: 'warning', field: 'mxik', params: { code } };
}

// ── Code structure (§7.3–7.5) ──────────────────────────────────────────────────────────────

/** The base code: group, class, position, subposition (first 11 digits, PKM 263 п.3). */
export const baseCode = (code: string): string => code.slice(0, 11);
/** A base-level code carries 000000 in brand and attribute. */
export const isBaseLevel = (code: string): boolean => /^\d{11}000000$/.test(code);
/** Services: the classifier's service groups start with 1 (goods follow TN VED, groups 001–099). */
export const isServiceCode = (code: string | null | undefined): boolean => Boolean(code && /^1\d{16}$/.test(code));

/**
 * The row's code against the code tasnif holds for the row's barcode (`gtin=` search). `gtinCode`
 * null = the barcode is not in tasnif (most barcodes are not), nothing to say.
 */
export function gtinCodeIssues(rowCode: string | null, gtin: string, gtinCode: string | null): ValidationIssue[] {
  if (!gtinCode || rowCode === gtinCode) return [];
  if (!rowCode) return [{ code: 'gtin_has_code', severity: 'info', field: 'mxik', params: { barcode: gtin, code: gtinCode }, suggestion: gtinCode }];
  if (baseCode(rowCode) !== baseCode(gtinCode)) {
    // §7.3/§7.5: a code of another base than the goods' own is fined (PKM 263 п.47, Tax Code art. 223).
    return [{ code: 'mxik_base_mismatch', severity: 'error', field: 'mxik', params: { barcode: gtin, code: rowCode, gtinCode }, suggestion: gtinCode }];
  }
  if (isBaseLevel(rowCode)) {
    // §7.4: the goods have their own identification code.
    return [{ code: 'gtin_brand_code_exists', severity: 'warning', field: 'mxik', params: { barcode: gtin, code: gtinCode }, suggestion: gtinCode }];
  }
  return [{ code: 'gtin_code_conflict', severity: 'warning', field: 'mxik', params: { barcode: gtin, code: rowCode, gtinCode }, suggestion: gtinCode }];
}

// ── Barcodes (§7.13, §7.14, §7.16) ─────────────────────────────────────────────────────────

export type BarcodeRead = {
  /** The barcode the product keeps: the first valid GTIN, else the first value as written. */
  primary: string | null;
  /** Valid GTINs (as written) that may be looked up in tasnif: never an in-store 02x/2x number. */
  lookup: string[];
  issues: ValidationIssue[];
};

/** Splits a barcode cell ("4780…;4780…", one per line, or spaced) and checks each value. */
export function readBarcodes(raw: string | null | undefined): BarcodeRead {
  const cell = (raw ?? '').trim();
  if (!cell) return { primary: null, lookup: [], issues: [] };
  const parts = cell.split(/[;,|/\n\r\t]+/).flatMap((part) => {
    const p = part.trim();
    if (!p) return [];
    const joined = p.replace(/\s+/g, '');
    // "4780042470127 4780042470134" is two codes; "478 0042 470127" is one.
    if (/\s/.test(p) && !barcodeIdentity(joined).gtin) return p.split(/\s+/);
    return [joined];
  });
  const issues: ValidationIssue[] = [];
  const lookup: string[] = [];
  for (const value of parts) {
    if (!/^\d+$/.test(value)) {
      issues.push({ code: 'barcode_not_numeric', severity: 'warning', field: 'barcode', params: { barcode: value.slice(0, 40) } });
      continue;
    }
    const id = barcodeIdentity(value);
    if (id.status === 'ok') lookup.push(value);
    else if (id.status === 'restricted') issues.push({ code: 'barcode_internal', severity: 'info', field: 'barcode', params: { barcode: value } });
    else if (id.status === 'bad_length') issues.push({ code: 'barcode_bad_length', severity: 'warning', field: 'barcode', params: { barcode: value, digits: value.length } });
    else if (id.status === 'bad_check_digit') issues.push({ code: 'barcode_invalid', severity: 'warning', field: 'barcode', params: { barcode: value } });
  }
  if (parts.length > 1) issues.push({ code: 'barcode_several', severity: 'info', field: 'barcode', params: { count: parts.length, kept: lookup[0] ?? parts[0] ?? '' } });
  return { primary: lookup[0] ?? parts[0] ?? null, lookup, issues };
}

// ── Prices and VAT (§7.19, §7.20) ──────────────────────────────────────────────────────────

/** A decimal text in tiyin (hundredths), half away from zero; null when it is not a number. */
export function toTiyin(decimal: string): bigint | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!m) return null;
  const frac = m[3] ?? '';
  let tiyin = BigInt(m[2] ?? '0') * 100n + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) tiyin += 1n;
  return m[1] === '-' ? -tiyin : tiyin;
}

/** Tiyin → "1234.50". */
export function fromTiyin(tiyin: bigint): string {
  const sign = tiyin < 0n ? '-' : '';
  const abs = tiyin < 0n ? -tiyin : tiyin;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/**
 * A price cell as a plain decimal: spaces, NBSP and apostrophes as thousands separators, a comma or a
 * dot as the decimal mark ("1 234 567,89", "1,234,567.89", "1.234.567,89"), a currency word dropped.
 */
export function plainDecimal(raw: string): string | null {
  let s = raw.trim().toLowerCase().replace(/(uzs|сум|сўм|so['ʻ‘’`]?m|sum)\.?$/u, '').replace(/[\s\u00a0\u202f']/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0 || lastDot >= 0) {
    // One kind of mark: several of it is grouping ("1,234,567", "1.234.567"); one with exactly three digits after a
    // 1–3 digit whole part not starting with 0 is thousands too, whichever mark ("12,500", "12.500" → 12500; amount.ts
    // reads it the same and calls it ambiguous); otherwise it is the decimal mark ("1234,5", "0,125").
    const mark = lastComma >= 0 ? ',' : '.';
    const grouped = s.split(mark).length > 2 || THOUSANDS.test(s);
    s = grouped ? s.split(mark).join('') : s.replace(mark, '.');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/** "12,500" / "12.500": one mark with exactly three digits after a short whole part, read as thousands. */
const THOUSANDS = /^-?[1-9]\d{0,2}[.,]\d{3}$/;

export type PriceRead = { price: string | null; issues: ValidationIssue[] };

/** The price rounded to tiyin; more than 2 decimals, an unreadable or a negative price is reported (§7.19). */
export function readPrice(raw: string | null | undefined): PriceRead {
  const cell = (raw ?? '').trim();
  if (!cell) return { price: null, issues: [] };
  const plain = plainDecimal(cell);
  const tiyin = plain === null ? null : toTiyin(plain);
  if (plain === null || tiyin === null) return { price: null, issues: [{ code: 'price_unreadable', severity: 'warning', field: 'price', params: { value: cell.slice(0, 40) } }] };
  const issues: ValidationIssue[] = [];
  const decimals = plain.split('.')[1]?.length ?? 0;
  if (decimals > 2) issues.push({ code: 'price_precision', severity: 'warning', field: 'price', params: { value: cell.slice(0, 40), rounded: fromTiyin(tiyin) } });
  if (tiyin < 0n) issues.push({ code: 'price_negative', severity: 'warning', field: 'price', params: { value: cell.slice(0, 40) } });
  // Read as thousands, but it may have meant a fraction: the reviewer confirms (review 30 Oct).
  if (THOUSANDS.test(cell.replace(/\s|[^\d.,-]+$/gu, ''))) issues.push({ code: 'price_ambiguous', severity: 'warning', field: 'price', params: { value: cell.slice(0, 40), read: fromTiyin(tiyin) } });
  return { price: fromTiyin(tiyin), issues };
}

/** "Цена с НДС" → true, "Narx (QQSsiz)" → false, a header that does not say → null (§7.19). */
export function priceIncludesVat(header: string | null | undefined): boolean | null {
  const h = (header ?? '').toLowerCase().replace(/[ʻʼ'`’‘]/g, '');
  if (/без\s*ндс|без\s*учета\s*ндс|qqs\s*siz|qqssiz|ққс\s*сиз|ққссиз|\bexcl|without\s*vat|\bnet\b/.test(h)) return false;
  if (/с\s*ндс|с\s*учетом\s*ндс|включая\s*ндс|вкл\.?\s*ндс|qqs\s*bilan|ққс\s*билан|\bincl|with\s*vat|\bgross\b/.test(h)) return true;
  return null;
}

export type VatRead = { vatRate: string | null; issues: ValidationIssue[] };

const WITHOUT_VAT = /^(без\s*ндс|без\s*налога|ндс\s*не\s*облагается|не\s*облагается|qqs\s*siz|qqssiz|qqs\s*yo[ʻ‘’']?q|ққс\s*сиз|ққссиз|without(\s*vat)?|no\s*vat|non[-\s]?vat|exempt|-|—)$/u;

/**
 * A VAT cell as the rate the ЭСФ carries (§7.20): "12", "12%", "QQS 12%", "НДС 12 %" → "12"; "0", "0%"
 * → "0" (zero-rated, not "without"); "без НДС", "Без налога", "QQSsiz" → "without"; an Excel percent
 * cell (0.12) → "12"; empty → null. 15 % (before 2023) and any other rate are kept and reported.
 */
export function readVat(raw: string | null | undefined): VatRead {
  const cell = (raw ?? '').trim();
  if (!cell) return { vatRate: null, issues: [] };
  const v = cell.toLowerCase().replace(/[ʻʼ`’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (WITHOUT_VAT.test(v)) return { vatRate: 'without', issues: [] };
  const m = /^(?:(?:ндс|qqs|ққс|vat|ставка ндс)\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*%?$/.exec(v);
  if (!m) return { vatRate: null, issues: [{ code: 'vat_unreadable', severity: 'warning', field: 'vat', params: { value: cell.slice(0, 40) } }] };
  let rate = Number((m[1] ?? '').replace(',', '.'));
  // A percent-formatted cell is read as its value: 12 % is 0.12.
  if (rate > 0 && rate < 1 && !v.includes('%')) rate = rate * 100;
  // Two decimals at most: a formula cell's float noise (12.000000000000014) would not fit the record (10 chars).
  rate = Math.round(rate * 100) / 100;
  const text = String(rate);
  if (rate === 12 || rate === 0) return { vatRate: text, issues: [] };
  return { vatRate: text, issues: [{ code: 'vat_rate_unusual', severity: 'warning', field: 'vat', params: { rate: text } }] };
}

/** Net, VAT and gross of a price in tiyin, from either side (VAT = gross × r/(100+r), §5). */
export function splitVat(priceTiyin: bigint, ratePercent: number, includesVat: boolean): { net: bigint; vat: bigint; gross: bigint } {
  const r = BigInt(Math.round(ratePercent * 100));
  const div = (a: bigint, b: bigint): bigint => (a * 2n + b) / (2n * b); // half up, a ≥ 0
  if (includesVat) {
    const vat = div(priceTiyin * r, 10_000n + r);
    return { net: priceTiyin - vat, vat, gross: priceTiyin };
  }
  const vat = div(priceTiyin * r, 10_000n);
  return { net: priceTiyin, vat, gross: priceTiyin + vat };
}

// ── Service rows (§7.23) ───────────────────────────────────────────────────────────────────

/** A service code counted in goods units, or a goods code counted as a service. */
export function serviceIssues(code: string | null, unit: string | null): ValidationIssue[] {
  const u = normalizeUnit(unit);
  if (!code || !u) return [];
  if (isServiceCode(code) && !SERVICE_UNIT_IDS.has(u.id)) {
    return [{ code: 'service_unit', severity: 'warning', field: 'unit', params: { unit: unit ?? '', expected: UNIT.service.name } }];
  }
  if (!isServiceCode(code) && u.id === UNIT.service.id) {
    return [{ code: 'service_unit_on_goods', severity: 'warning', field: 'unit', params: { unit: unit ?? '', code } }];
  }
  return [];
}

// ── Duplicates within one file (§7.17) ─────────────────────────────────────────────────────

export type DuplicateRow = { name: string; barcode: string | null; mxik: string | null; packageCode: string | null };

/**
 * Rows that repeat an earlier row of the same file, by index: the same name, ИКПУ and package
 * (`duplicate_row`); the same name with another code, package or internal code (`duplicate_name`:
 * 1C would match both to one item by name); the same barcode (`duplicate_barcode`: allowed in 1C,
 * worth a look). The first occurrence is not flagged; `row` is its 1-based data row.
 */
export function fileDuplicates(rows: readonly DuplicateRow[]): Map<number, ValidationIssue[]> {
  const out = new Map<number, ValidationIssue[]>();
  const add = (i: number, issue: ValidationIssue): void => { out.set(i, [...(out.get(i) ?? []), issue]); };
  const byFull = new Map<string, number>();
  const byName = new Map<string, number>();
  const byBarcode = new Map<string, number>();
  rows.forEach((r, i) => {
    const name = productNameKey(r.name);
    if (!name) return;
    const full = `${name}|${r.mxik ?? ''}|${r.packageCode ?? ''}`;
    const sameRow = byFull.get(full);
    if (sameRow !== undefined) add(i, { code: 'duplicate_row', severity: 'warning', field: 'name', params: { row: sameRow + 1 } });
    else byFull.set(full, i);
    const named = byName.get(name);
    if (named !== undefined && sameRow === undefined) add(i, { code: 'duplicate_name', severity: 'warning', field: 'name', params: { row: named + 1 } });
    else if (named === undefined) byName.set(name, i);
    const barcode = r.barcode?.replace(/^0+/, '') ?? '';
    if (barcode) {
      const seen = byBarcode.get(barcode);
      if (seen !== undefined && sameRow === undefined) add(i, { code: 'duplicate_barcode', severity: 'warning', field: 'barcode', params: { row: seen + 1, barcode: r.barcode ?? '' } });
      else if (seen === undefined) byBarcode.set(barcode, i);
    }
  });
  return out;
}

// ── Packages and units over a tasnif card (§7.7, §7.8, §7.10, §7.12) ───────────────────────

/**
 * The unit a package is counted in. A plain-unit package (consumer level, no container, its name
 * a unit: "килограмм", "шт.") counts in that unit. Any other package is one piece: a consumer pack
 * "шт. (упаковка) 200 грамм" (whose unitId is the gram of its contents, live 00405001001106002) or a
 * container "40 шт. (упаковка) 200 грамм".
 */
export function packageCountingUnit(p: Pick<TasnifPackage, 'name' | 'containerName' | 'isUnitPackage' | 'unitId'>): number {
  const plain = p.isUnitPackage === '1' && !p.containerName && !/\d/.test(p.name);
  // "тысяча тонн", "миллион тонн": a unit the table does not know still counts in its own unitId.
  if (plain) return normalizeUnit(p.name)?.id ?? p.unitId ?? UNIT.piece.id;
  return UNIT.piece.id;
}

/** The units the card allows (its consumer-level packages); one unit = a strictly fixed code (PKM 263 п.16). */
export function allowedUnits(packages: readonly Pick<TasnifPackage, 'name' | 'containerName' | 'isUnitPackage' | 'unitId' | 'type'>[]): Set<number> {
  return new Set(packages.filter((p) => p.isUnitPackage === '1' || p.type === '1').map(packageCountingUnit));
}

/** Packages of the card that fit a row's unit and could fill its empty package code (§7.8). */
export function packagesForUnit<P extends Pick<TasnifPackage, 'code' | 'name' | 'containerName' | 'isUnitPackage' | 'unitId' | 'type'>>(packages: readonly P[], unitId: number): P[] {
  const consumer = packages.filter((p) => p.isUnitPackage === '1' || p.type === '1');
  // A plain unit package of exactly that unit first ("килограмм" for kg), then consumer packs counted in pieces.
  const plain = consumer.filter((p) => !p.containerName && !/\d/.test(p.name) && packageCountingUnit(p) === unitId);
  return plain.length > 0 ? plain : consumer.filter((p) => packageCountingUnit(p) === unitId);
}

/**
 * The row's unit against the units the card allows (§7.10): outside a strictly fixed unit is an
 * error, outside a longer list a warning (the taxpayer may still create a consumer package).
 */
export function unitAllowedIssue(unit: string | null, allowed: ReadonlySet<number>, unitNames: ReadonlyMap<number, string>): ValidationIssue | null {
  const u = normalizeUnit(unit);
  if (!u || allowed.size === 0 || allowed.has(u.id)) return null;
  const expected = [...allowed].map((id) => unitNames.get(id) ?? String(id)).join(' / ');
  return { code: allowed.size === 1 ? 'unit_fixed' : 'unit_not_allowed', severity: allowed.size === 1 ? 'error' : 'warning', field: 'unit', params: { unit: unit ?? '', expected } };
}

// ── Changed codes: 30-day grace (§7.31, onec §8.12) ────────────────────────────────────────

/** A change or deletion of an ИКПУ takes effect 30 days after it is published (PKM 263 п.42). */
export const GRACE_DAYS = 30;

/**
 * A code the classifier export stopped listing on `retiredAt`: still usable until `until` (warn), an
 * error afterwards. `retiredAt` is the day our snapshot first missed it, at the latest the publication.
 */
export function retiredGrace(retiredAt: Date, today: Date): { inGrace: boolean; until: string } {
  const until = new Date(retiredAt.getTime() + GRACE_DAYS * 86_400_000);
  return { inGrace: today.getTime() < until.getTime(), until: until.toISOString().slice(0, 10) };
}
