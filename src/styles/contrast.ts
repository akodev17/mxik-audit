// WCAG 2.x relative luminance and contrast ratio for #rgb, #rrggbb and rgb() colours.

export type Rgb = { r: number; g: number; b: number; a: number };

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:\s*[/,]\s*([\d.]+%?))?\s*\)$/i;

/** Parses a CSS colour literal; null for anything else (var(), named colours). */
export function parseColor(value: string): Rgb | null {
  const v = value.trim();
  const hex = HEX.exec(v);
  if (hex) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16), a: 1 };
  }
  const rgb = RGB.exec(v);
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: alpha };
}

/** Composites a translucent colour over an opaque backdrop. */
export function over(top: Rgb, backdrop: Rgb): Rgb {
  const mix = (f: number, b: number): number => Math.round(f * top.a + b * (1 - top.a));
  return { r: mix(top.r, backdrop.r), g: mix(top.g, backdrop.g), b: mix(top.b, backdrop.b), a: 1 };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 to 21. A translucent foreground is composited first. */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const top = fg.a < 1 ? over(fg, bg) : fg;
  const [hi, lo] = [luminance(top), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
