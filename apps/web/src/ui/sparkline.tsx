/** Tiny trend line; the last point is emphasised. Decorative: the numbers are printed beside it. */
export function Sparkline({ values, width = 72, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (width - 6) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [3 + i * step, height - 3 - (v / max) * (height - 6)] as const);
  const last = pts[pts.length - 1];
  const falling = values.length > 1 && (values[values.length - 1] ?? 0) <= (values[0] ?? 0);
  const stroke = falling ? 'var(--color-good)' : 'var(--color-danger)';
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r="2.4" fill={stroke} /> : null}
    </svg>
  );
}
