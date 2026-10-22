// The PDF behind a share link, when the link allows it (@tasnivo/domain/catalog-exports).
import { sharePdf } from '@tasnivo/domain/catalog-exports';
import { downloadResponse } from '@/lib/download';
import { getLocale } from '@/lib/locale';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return downloadResponse(await sharePdf(token, await getLocale()));
}
