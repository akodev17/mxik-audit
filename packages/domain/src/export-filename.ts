// Download file names: the uploaded name without its extension plus a suffix,
// sent as an ASCII fallback and as UTF-8 (RFC 6266 / 5987), so Cyrillic and
// Uzbek names survive in every browser. Pure.

/** The uploaded file's name without .xlsx, .xls or .csv. */
export const baseName = (filename: string): string => filename.replace(/\.(xlsx|xls|csv)$/i, '').trim() || 'mxik-audit';

/** Printable ASCII only, without quotes, backslashes or path separators. */
export function asciiFallback(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\/;:*?<>|]/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return ascii === '' || /^[_.]+$/.test(ascii.replace(/\.[a-z0-9]+$/i, '')) ? `mxik-audit${/\.[a-z0-9]+$/i.exec(name)?.[0] ?? ''}` : ascii;
}

/** RFC 5987 encoding: everything outside attr-char is percent-encoded. */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function contentDisposition(kind: 'attachment' | 'inline', filename: string): string {
  return `${kind}; filename="${asciiFallback(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/** The file name a Content-Disposition header carries, preferring the UTF-8 form; null without one. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8.trim());
    } catch {
      // A malformed escape falls back to the plain name.
    }
  }
  return /filename="([^"]*)"/i.exec(header)?.[1] ?? null;
}
