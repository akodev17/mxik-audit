// An empty purchase-list template in the requester's language. Any other
// layout works too: the columns are chosen after upload.
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { contentDisposition } from '@/lib/export-filename';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const template = (await getI18n()).ta.importX.templates.purchases;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.sheet);
  sheet.addRow([...template.headers]);
  sheet.getRow(1).font = { bold: true };
  // 17-digit codes must stay text, or Excel shows 1.7E+16.
  sheet.getColumn(2).numFmt = '@';
  sheet.columns.forEach((c) => { c.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition('attachment', template.file),
      'cache-control': 'no-store',
    },
  });
}
