import { Fragment } from 'react';

// Instrument Serif draws the Uzbek modifier letters ʻ and ʼ wide, which opens a gap inside words
// like oʻ and gʻ at headline size. Wrapping them lets landing.css pull the neighbours back in.
export function tight(text: string): React.ReactNode {
  return text.split(/([ʻʼ])/).map((part, i) =>
    part === 'ʻ' || part === 'ʼ' ? <span key={i} className="lp-apos">{part}</span> : <Fragment key={i}>{part}</Fragment>,
  );
}
