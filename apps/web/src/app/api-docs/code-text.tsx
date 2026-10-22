/** @jsxRuntime automatic */
import type { ReactNode } from 'react';

// Identifiers that appear in the docs prose: variables, paths, fields, headers and error codes.
// One capturing group, so split() puts every identifier at an odd index.
const TOKEN = /(\$BASE|\$KEY|\/api\/v1\/[\w/{}.-]*[\w}]|\/check\b|\bnextCursor\b|\bcursor\b|\blimit\b|\bclientId\b|\bstatus\b|\bready\b|\bsummary\b|\bfindings\b|\bnull\b|\bconfidence\b|\bAuthorization\b|\bIdempotency-Key\b|\bIdempotent-Replayed(?:: true)?|\bX-RateLimit-(?:Limit|Remaining)\b|\bRetry-After\b|\b[a-z]+(?:_[a-z]+)+\b)/;

/** Splits docs prose into plain text and identifiers. */
export function splitCode(text: string): { text: string; code: boolean }[] {
  return text.split(TOKEN).map((part, i) => ({ text: part, code: i % 2 === 1 })).filter((part) => part.text !== '');
}

/** Docs prose with identifiers in the mono code style. */
export function CodeText({ children }: { children: string }): ReactNode {
  return splitCode(children).map((part, i) => (part.code
    ? <code key={i} className="rounded-sm bg-sunken px-1 py-px font-mono text-mono">{part.text}</code>
    : part.text));
}
