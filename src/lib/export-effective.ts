// The code a row carries after review, and how far its review got. One rule for
// the corrected Excel, the 1C file, the PDF and the purchase check: the latest
// accepted decision wins over the file's code; a row with any risky finding
// still pending is "partly reviewed" (or "not reviewed"), never clean. Pure.

export type EffectiveFinding = {
  severity: string;
  decision: string;
  chosenMxik: string | null;
  decidedAt: Date | null;
};

/**
 * ok: nothing risky found. accepted / rejected: every risky finding decided.
 * partial: some decided, some still pending. pending: none decided.
 */
export type RowReview = 'ok' | 'accepted' | 'rejected' | 'partial' | 'pending';

export type EffectiveRow = {
  code: string | null;
  /** The accepted code that replaced the file's, when there is one. */
  acceptedCode: string | null;
  review: RowReview;
};

/** The most recently accepted code among the row's findings, or null. */
export function latestAccepted(findings: readonly EffectiveFinding[]): string | null {
  let best: EffectiveFinding | null = null;
  for (const f of findings) {
    if (f.decision !== 'accepted' || !f.chosenMxik) continue;
    if (!best || (f.decidedAt?.getTime() ?? 0) >= (best.decidedAt?.getTime() ?? 0)) best = f;
  }
  return best?.chosenMxik ?? null;
}

/** The code the row carries: an accepted decision on any finding, else the file's own. */
export function effectiveCode(existing: string | null, findings: readonly EffectiveFinding[]): string | null {
  return latestAccepted(findings) ?? existing;
}

export function effectiveRow(existing: string | null, findings: readonly EffectiveFinding[]): EffectiveRow {
  const acceptedCode = latestAccepted(findings);
  const code = acceptedCode ?? existing;
  // Informational findings (a non-trade client's purchase check) are shown, never counted as risk.
  const risky = findings.filter((f) => f.severity !== 'info');
  if (risky.length === 0) return { code, acceptedCode, review: 'ok' };
  const pending = risky.filter((f) => f.decision === 'pending').length;
  if (pending === risky.length) return { code, acceptedCode, review: 'pending' };
  if (pending > 0) return { code, acceptedCode, review: 'partial' };
  const accepted = acceptedCode !== null || risky.some((f) => f.decision === 'accepted');
  return { code, acceptedCode, review: accepted ? 'accepted' : 'rejected' };
}
