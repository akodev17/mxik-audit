import { ImageResponse } from 'next/og';

// The link preview Telegram shows when the page is shared — where most of this
// audience will first see it. Generated at build time from the page's own
// palette, no stock imagery.
//
// The bundled font has Latin only and no U+02BB, so the copy avoids oʻ / gʻ
// rather than render a wrong apostrophe on a page that makes a point of them.
export const alt = 'Tasnivo — katalogdagi MXIK kodlarini tekshiring';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  const row = (name: string, code: string, verdict: string, risk: boolean) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '2px solid #dde0e7',
        padding: '18px 0',
        fontSize: 26,
      }}
    >
      <div style={{ display: 'flex', color: '#14161c' }}>{name}</div>
      <div style={{ display: 'flex', gap: 28 }}>
        <div style={{ display: 'flex', color: '#4e5564', fontFamily: 'monospace' }}>{code}</div>
        <div style={{ display: 'flex', color: risk ? '#a32b22' : '#1b6b52', width: 210, justifyContent: 'flex-end' }}>
          {verdict}
        </div>
      </div>
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#fbfbfc',
          padding: '64px 72px',
          borderTop: '14px solid #2457f5',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 700, color: '#14161c' }}>
          <svg width="44" height="44" viewBox="0 0 28 28"><rect x="0" y="0" width="8" height="8" rx="2" fill="#14161c"/><rect x="10" y="0" width="8" height="8" rx="2" fill="#14161c"/><rect x="20" y="0" width="8" height="8" rx="2" fill="#14161c"/><rect x="10" y="10" width="8" height="8" rx="2" fill="#14161c"/><rect x="10" y="20" width="8" height="8" rx="2" fill="#14161c"/><rect x="20" y="10" width="8" height="8" rx="2" fill="#2457f5"/></svg>
          Tasnivo
        </div>
        <div style={{ display: 'flex', marginTop: 22, fontSize: 64, lineHeight: 1.08, color: '#14161c', maxWidth: 980 }}>
          Katalogingizdagi xavfli MXIK kodlarini toping
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          {row('Excel / CSV katalog', '17 xonali kod', 'tekshiriladi', false)}
          {row('Rasmiy tasniflagich bilan solishtirish', 'har bir qator', 'xato ajratiladi', true)}
          <div style={{ display: 'flex', marginTop: 22, fontSize: 24, color: '#4e5564' }}>
            Risk auditi bepul · Qarorni siz qabul qilasiz
          </div>
        </div>
      </div>
    ),
    size,
  );
}
