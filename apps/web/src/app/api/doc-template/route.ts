// A blank template for the cheque list and the sales export. Headers only: the
// upload flow maps whatever columns the user's file really has.
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { contentDisposition } from '@/lib/export-filename';
import { getI18n } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const kind = new URL(request.url).searchParams.get('kind') === 'sales' ? 'sales' : 'cheques';
  const template = (await getI18n()).ta.importX.templates[kind];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(template.sheet);
  sheet.addRow([...template.headers]).font = { bold: true };
  sheet.columns.forEach((c) => { c.width = 26; });
  // Codes must stay text, or Excel shows 1.7E+16 and drops leading zeros.
  sheet.getColumn(2).numFmt = '@';
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition('attachment', template.file),
      'cache-control': 'no-store',
    },
  });
}
