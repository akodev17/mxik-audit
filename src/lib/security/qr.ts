// QR codes for the authenticator setup, drawn as one SVG path on the server.
// qrcode-generator: zero dependencies, MIT, maintained since 2014.
import qrcode from 'qrcode-generator';

/** Light modules around the code that scanners need. */
const QUIET_ZONE = 4;

export type QrPath = { size: number; path: string };

/** Dark modules of `text` as an SVG path in a size x size box (quiet zone included); runs in a row are merged. */
export function qrPath(text: string): QrPath {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.isDark(row, col)) continue;
      let run = 1;
      while (col + run < n && qr.isDark(row, col + run)) run++;
      parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h${run}v1h-${run}z`);
      col += run - 1;
    }
  }
  return { size: n + 2 * QUIET_ZONE, path: parts.join('') };
}
