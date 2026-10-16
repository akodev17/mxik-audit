import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lookupCode } from '@/lib/audit-runner';
import { resolveCatalog } from '@/lib/catalogs';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
import { billingConfig } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { build1cCsv } from '@/lib/export-1c';
import { buildExport, type ExportRow } from '@/lib/spreadsheet';

const StoredAttrs = z.object({ original: z.array(z.string()) });
const StoredMap = z.object({
  name: z.number(), barcode: z.number(), mxik: z.number(),
  unit: z.number(), price: z.number(),
});

/**
 * Rebuilds the uploaded file with accepted decisions applied. Rejected and
 * undecided rows keep their original values and are flagged in `audit_status`,
 * so nothing is changed silently.
 */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Any of the org's catalogues; another org's id is the same 404 as a missing one.
  const url = new URL(request.url);
  const requested = url.searchParams.get('catalog');
  const format = url.searchParams.get('format') === '1c' ? '1c' : 'original';
  const catalog = requested ? await resolveCatalog(user.orgId, requested) : null;
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });
  // An unaudited catalogue would export every row as "risk_yoq".
  if (catalog.status !== 'ready') return NextResponse.json({ error: 'audit not finished' }, { status: 409 });
  // Only when the operator turned payment on for exports.
  if (billingConfig().requiredForExport && !(await catalogPaid(user.orgId, catalog.id))) {
    return NextResponse.json({ error: 'payment required' }, { status: 402 });
  }

  const mapping = StoredMap.safeParse(catalog.columnMap);
  if (!mapping.success) return NextResponse.json({ error: 'bad mapping' }, { status: 500 });

  const items = await db.catalogItem.findMany({
    where: { catalogId: catalog.id },
    orderBy: { rowIndex: 'asc' },
    include: { findings: { select: { decision: true, chosenMxik: true, type: true, severity: true } } },
  });

  // One lookup per distinct accepted code, for its bound unit and packaging.
  const accepted = [...new Set(
    items.flatMap((i) => i.findings
      .filter((f) => f.decision === 'accepted' && f.chosenMxik)
      .map((f) => f.chosenMxik as string)),
  )];
  const details = new Map(
    (await Promise.all(accepted.map(async (c) => [c, await lookupCode(c)] as const)))
      .filter(([, d]) => d !== null),
  );

  const rows: ExportRow[] = items.map((item) => {
    const attrs = StoredAttrs.safeParse(item.attrs);
    const original = attrs.success ? attrs.data.original : [];

    // Informational findings (e.g. a non-trade client's purchase check) are not risk.
    if (item.findings.every((f) => f.severity === 'info')) {
      return {
        original,
        mxik: item.existingMxik ?? '',
        unit: item.unit ?? '',
        packaging: '',
        auditStatus: t.exportStatusOk,
      };
    }

    const acceptedFinding = item.findings.find((f) => f.decision === 'accepted' && f.chosenMxik);
    if (acceptedFinding?.chosenMxik) {
      const detail = details.get(acceptedFinding.chosenMxik);
      return {
        original,
        mxik: acceptedFinding.chosenMxik,
        // A UNIT_CONFLICT acceptance means the unit was the thing being fixed.
        unit: detail?.unitBinding === 'strict' && detail.unitCanonical[0]
          ? detail.unitCanonical[0]
          : (item.unit ?? ''),
        packaging: detail?.unitContainer ?? '',
        auditStatus: t.exportStatusAccepted,
      };
    }

    const rejected = item.findings.some((f) => f.decision === 'rejected');
    return {
      original,
      // Rejected and undecided rows keep exactly what they came in with.
      mxik: item.existingMxik ?? '',
      unit: item.unit ?? '',
      packaging: '',
      auditStatus: rejected ? t.exportStatusRejected : t.exportStatusPending,
    };
  });

  const base = catalog.filename.replace(/\.(xlsx|csv)$/i, '');
  if (format === '1c') {
    const csv = build1cCsv(items.map((item, i) => ({
      name: item.rawName,
      mxik: rows[i]?.mxik ?? '',
      unit: rows[i]?.unit ?? '',
      barcode: item.barcode ?? '',
      auditStatus: rows[i]?.auditStatus ?? '',
    })));
    await db.auditEvent.create({
      data: {
        orgId: user.orgId, actorId: user.userId, action: 'catalog.exported', targetId: catalog.id,
        payload: { rows: rows.length, acceptedCodes: accepted.length, format: '1c' },
      },
    });
    return new NextResponse(new Uint8Array(csv), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${encodeURIComponent(base)}-1c.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  const buffer = await buildExport({
    headers: catalog.headers,
    rows,
    mxikColumn: mapping.data.mxik >= 0 ? mapping.data.mxik : null,
    unitColumn: mapping.data.unit >= 0 ? mapping.data.unit : null,
    labels: {
      mxik: t.uploadColumnMxik,
      unit: t.uploadColumnUnit,
      packaging: 'qadoqlash',
      auditStatus: t.exportStatusColumn,
    },
  });

  await db.auditEvent.create({
    data: {
      orgId: user.orgId, actorId: user.userId, action: 'catalog.exported',
      targetId: catalog.id,
      payload: { rows: rows.length, acceptedCodes: accepted.length },
    },
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${encodeURIComponent(base)}-mxik-audit.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
