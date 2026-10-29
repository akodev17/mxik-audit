// Suggestion-engine status for operators. Shown on /admin and written to logs,
// never on customer screens: the customer sees labelled suggestions either way.
// The vector line reuses the audit's own readiness check, so a substituted
// non-semantic stand-in is reported as degraded, as the audit treats it.
import { Prisma } from '@prisma/client';
import { rerankConfigFromEnv } from '@tasnivo/core/match/rerank-config';
import type { VectorReadiness } from '@tasnivo/core/match/vector-readiness';
import { vectorReadiness } from './audit-runner.js';
import { db } from '@tasnivo/db';
import { fmtDateTime, fmtNumber } from '@tasnivo/i18n/format';
import type { Locale } from '@tasnivo/i18n/i18n';
import { appDict, type AppDict } from '@tasnivo/i18n/i18n-app';
import { readPipelineMeta, type PipelineMeta } from './pipeline-meta.js';
import { restrictedState, type RestrictedState } from './restricted-state.js';

export type StatusLine = { label: string; value: string; ok: boolean };

type View = { ta: AppDict; locale: Locale };

export function vectorLine(readiness: VectorReadiness, { ta, locale }: View): StatusLine {
  const s = ta.matchX.status;
  const { stored, embedder } = readiness;
  if (!readiness.usable) return { label: s.vectorLabel, value: s.vectorOff(readiness.reason ?? ''), ok: false };
  if (!embedder.semantic) return { label: s.vectorLabel, value: s.vectorStandIn(embedder.name), ok: false };
  const rows = stored?.rowsEmbedded ?? 0;
  return { label: s.vectorLabel, value: s.vectorOk(embedder.name, rows, fmtNumber(locale, rows)), ok: true };
}

export function lastAuditLine(meta: PipelineMeta | null, { ta, locale }: View): StatusLine {
  const s = ta.matchX.status;
  if (!meta) return { label: s.lastAuditLabel, value: s.lastAuditNone, ok: true };
  const when = meta.finishedAt ? fmtDateTime(locale, meta.finishedAt) : '';
  if (meta.degradedReasons.length === 0) return { label: s.lastAuditLabel, value: s.lastAuditFull(when), ok: true };
  const reasons = meta.degradedReasons.map((r) => s.reasonShort[r]).join(', ');
  return { label: s.lastAuditLabel, value: s.lastAuditDegraded(when, reasons), ok: false };
}

/** The restricted-code list: how many codes and when; empty or unreadable means audits do not check RESTRICTED. */
export function restrictedLine(state: RestrictedState, { ta, locale }: View): StatusLine {
  const s = ta.matchX.status;
  if (!state) return { label: s.restrictedLabel, value: s.restrictedFailed, ok: false };
  if (state.codes === 0) return { label: s.restrictedLabel, value: s.restrictedEmpty, ok: false };
  const when = state.importedAt ? fmtDateTime(locale, state.importedAt) : '';
  return { label: s.restrictedLabel, value: s.restrictedOk(state.codes, fmtNumber(locale, state.codes), when), ok: true };
}

/** The most recent audit's pipeline metadata, across orgs: this page is for platform operators. */
async function latestMeta(): Promise<PipelineMeta | null> {
  const row = await db.catalog.findFirst({
    where: { pipelineMeta: { not: Prisma.DbNull } },
    orderBy: { auditStartedAt: { sort: 'desc', nulls: 'last' } },
    select: { pipelineMeta: true },
  }).catch(() => null);
  return readPipelineMeta(row?.pipelineMeta);
}

export async function pipelineStatus(env: NodeJS.ProcessEnv = process.env, view: View = { ta: appDict('uz'), locale: 'uz' }): Promise<StatusLine[]> {
  const s = view.ta.matchX.status;
  const rerank = rerankConfigFromEnv(env);
  const [readiness, meta, restricted] = await Promise.all([vectorReadiness().catch(() => null), latestMeta(), restrictedState()]);
  return [
    {
      label: s.rerankLabel,
      value: rerank.enabled ? s.rerankOn(rerank.name) : s.rerankOff(rerank.disabledReason ?? ''),
      ok: rerank.enabled,
    },
    readiness ? vectorLine(readiness, view) : { label: s.vectorLabel, value: s.vectorOff(''), ok: false },
    restrictedLine(restricted, view),
    lastAuditLine(meta, view),
  ];
}
