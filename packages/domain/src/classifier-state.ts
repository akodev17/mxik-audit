// The classifier copy as the app sees it: newest snapshot, its age and how the
// last update ended. Read by /api/health, the stale banner and the daily job.
import { ageInDays, bannerReasons, resolveLastUpdate, type BannerReason, type LastUpdate } from './classifier-freshness.js';
import { readUpdateStatus } from './classifier-status.js';
import { db } from '@tasnivo/db';

export type ClassifierState = {
  takenAt: Date | null;
  ageDays: number | null;
  codeCount: number | null;
  lastUpdate: LastUpdate | null;
  banner: BannerReason[];
};

export async function latestSnapshot(): Promise<{ id: number; takenAt: Date; codeCount: number } | null> {
  return db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true, takenAt: true, codeCount: true } });
}

export async function classifierState(now = new Date()): Promise<ClassifierState> {
  const snapshot = await latestSnapshot();
  const lastUpdate = resolveLastUpdate(snapshot, readUpdateStatus());
  return {
    takenAt: snapshot?.takenAt ?? null,
    ageDays: snapshot ? ageInDays(snapshot.takenAt, now) : null,
    codeCount: snapshot?.codeCount ?? null,
    lastUpdate,
    banner: bannerReasons(snapshot, lastUpdate, now),
  };
}

