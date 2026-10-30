// An .xlsx written with ExcelJS's streaming writer: each committed row is serialised and dropped,
// so only the zipped bytes are held. `fill` adds the sheets and rows; the caller commits each row.
import { PassThrough } from 'node:stream';
import ExcelJS from 'exceljs';

export type StreamedWorkbook = InstanceType<typeof ExcelJS.stream.xlsx.WorkbookWriter>;

export async function streamedXlsx(fill: (workbook: StreamedWorkbook) => Promise<void>): Promise<Buffer> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve, reject) => {
    sink.on('end', resolve);
    sink.on('error', reject);
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: sink, useStyles: true, useSharedStrings: true });
  workbook.creator = 'Tasnivo';
  await fill(workbook);
  await workbook.commit();
  await finished;
  return Buffer.concat(chunks);
}
