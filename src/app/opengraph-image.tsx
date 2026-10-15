import { ImageResponse } from 'next/og';

// The link preview Telegram shows when the page is shared — where most of this
// audience will first see it. Generated at build time from the page's own
// palette, no stock imagery.
//
// The bundled font has Latin only and no U+02BB, so the copy avoids oʻ / gʻ
// rather than render a wrong apostrophe on a page that makes a point of them.
export const alt = 'MXIK Audit — katalogingizdagi xavfli MXIK kodlarini toping';
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
          borderTop: '14px solid #a32b22',
        }}
      >
        <div style={{ display: 'flex', fontSize: 28, color: '#4e5564', letterSpacing: 4 }}>
          MXIK AUDIT
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
