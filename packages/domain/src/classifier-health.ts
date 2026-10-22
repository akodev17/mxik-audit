// The classifier part of /api/health. Dates are ISO strings; `stale` is the
// same 7-day rule the banner uses, so an uptime check and the UI agree.
import type { ClassifierState } from './classifier-state.js';

export type ClassifierHealth = {
  loaded: boolean;
  takenAt: string | null;
  ageDays: number | null;
  codeCount: number | null;
  stale: boolean;
  lastUpdate: { outcome: 'success' | 'failed'; at: string; message: string | null } | null;
};

export function classifierHealth(loaded: boolean, state: ClassifierState | null): ClassifierHealth {
  return {
    loaded,
    takenAt: state?.takenAt?.toISOString() ?? null,
    ageDays: state?.ageDays ?? null,
    codeCount: state?.codeCount ?? null,
    stale: state?.banner.includes('stale') ?? false,
    lastUpdate: state?.lastUpdate
      ? { outcome: state.lastUpdate.outcome, at: state.lastUpdate.at.toISOString(), message: state.lastUpdate.message }
      : null,
  };
}
