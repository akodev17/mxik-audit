// An empty purchase-list template. Any other layout works too: the columns
// are chosen after upload.
import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Kirim');
  sheet.addRow(['Tovar nomi', 'MXIK kodi', 'Oʻlchov birligi', 'Miqdori', 'Summasi', 'Yetkazib beruvchi', 'EHF raqami', 'Sana']);
  sheet.getRow(1).font = { bold: true };
  // 17-digit codes must stay text, or Excel shows 1.7E+16.
  sheet.getColumn(2).numFmt = '@';
  sheet.columns.forEach((c) => { c.width = 22; });
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="kirim-shablon.xlsx"',
    },
  });
}
