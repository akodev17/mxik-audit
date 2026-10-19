'use client';

import type { CSSProperties } from 'react';
import { ru, uz } from '@/lib/i18n-parts/shell';

// Replaces the root layout, so neither the stylesheet nor the language cookie can be relied on:
// inline styles with system colours (they follow the OS theme) and both languages at once.
const page: CSSProperties = {
  colorScheme: 'light dark', background: 'Canvas', color: 'CanvasText', margin: 0, minHeight: '100dvh',
  display: 'grid', placeItems: 'center', fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif', lineHeight: 1.5,
};
const box: CSSProperties = { maxWidth: '30rem', padding: '2rem 1.5rem', textAlign: 'center' };
const button: CSSProperties = {
  font: 'inherit', fontWeight: 600, padding: '0.5rem 1rem', borderRadius: 8, border: '1px solid ButtonBorder',
  background: 'ButtonFace', color: 'ButtonText', cursor: 'pointer',
};

/** Last-resort error page when the root layout itself fails. */
export default function GlobalError(_props: { error: Error & { digest?: string }; reset: () => void }) {
  const a = uz.shellX.globalError;
  const b = ru.shellX.globalError;
  return (
    <html lang="uz">
      <body style={page}>
        <main style={box}>
          <h1 style={{ fontSize: 22, margin: 0 }}>{a.title}</h1>
          <p style={{ margin: '0.5rem 0 0' }}>{a.hint}</p>
          <p lang="ru" style={{ fontSize: 22, fontWeight: 600, margin: '1.5rem 0 0' }}>{b.title}</p>
          <p lang="ru" style={{ margin: '0.5rem 0 0' }}>{b.hint}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: '1.5rem' }}>
            <button type="button" onClick={() => window.location.reload()} style={button}>{a.retry} / <span lang="ru">{b.retry}</span></button>
            {/* A full page load, since the client router may be what failed. */}
            <a href="/dashboard" style={{ ...button, textDecoration: 'none' }}>{a.home} / <span lang="ru">{b.home}</span></a>
          </div>
        </main>
      </body>
    </html>
  );
}
