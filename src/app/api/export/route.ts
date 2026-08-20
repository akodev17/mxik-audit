import { NextResponse } from 'next/server';
import { z } from 'zod';
import { lookupCode } from '@/lib/audit-runner';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { currentUser } from '@/lib/session';
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
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const catalog = await db.catalog.findFirst({
    where: { orgId: user.orgId },
    orderBy: { createdAt: 'desc' },
  });
  if (!catalog) return NextResponse.json({ error: 'no catalog' }, { status: 404 });

  const mapping = StoredMap.safeParse(catalog.columnMap);
  if (!mapping.success) return NextResponse.json({ error: 'bad mapping' }, { status: 500 });

  const items = await db.catalogItem.findMany({
    where: { catalogId: catalog.id },
    orderBy: { rowIndex: 'asc' },
    include: { findings: { select: { decision: true, chosenMxik: true, type: true } } },
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

    if (item.findings.length === 0) {
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

  const base = catalog.filename.replace(/\.(xlsx|csv)$/i, '');
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${encodeURIComponent(base)}-mxik-audit.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
