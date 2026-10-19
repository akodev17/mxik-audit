// A blank template for the cheque list and the sales export. Headers only: the
// upload flow maps whatever columns the user's file really has.
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { contentDisposition } from '@/lib/export-filename';
import { getLocale } from '@/lib/locale';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const HEADERS = {
  uz: {
    cheques: ['Tovar nomi', 'Ishlatilgan MXIK kodi', 'Oʻlchov birligi', 'Soni', 'Summasi'],
    sales: ['Tovar nomi', 'MXIK kodi', 'Oʻlchov birligi', 'Sana', 'Soni', 'Summasi'],
  },
  ru: {
    cheques: ['Наименование товара', 'Использованный код ИКПУ', 'Единица измерения', 'Количество', 'Сумма'],
    sales: ['Наименование товара', 'Код ИКПУ', 'Единица измерения', 'Дата', 'Количество', 'Сумма'],
  },
} as const;

export async function GET(request: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const kind = new URL(request.url).searchParams.get('kind') === 'sales' ? 'sales' : 'cheques';
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(kind);
  sheet.addRow([...HEADERS[await getLocale()][kind]]).font = { bold: true };
  sheet.columns.forEach((c) => { c.width = 26; });
  // Codes must stay text, or Excel shows 1.7E+16 and drops leading zeros.
  sheet.getColumn(2).numFmt = '@';
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': contentDisposition('attachment', `${kind}-template.xlsx`),
      'cache-control': 'no-store',
    },
  });
}
