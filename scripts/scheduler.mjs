// Runs the scheduled jobs from DEPLOY.md section 7 inside the compose network, so no host crontab is needed.
import { spawn } from 'node:child_process';

const TZ_OFFSET_H = 5; // Uzbekistan time, UTC+5, no DST
const APP_URL = process.env.INTERNAL_APP_URL ?? 'http://app:3000';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

// Run an npm script and log how it ended.
function npmRun(script) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], { stdio: 'inherit' });
    child.on('exit', (code) => {
      console.log(`[scheduler] ${script} exited with ${code}`);
      resolve();
    });
  });
}

// Call a cron route of the app with the shared secret.
async function callRoute(path) {
  if (CRON_SECRET.length < 16) {
    console.log(`[scheduler] skip ${path}: CRON_SECRET is not set`);
    return;
  }
  try {
    const res = await fetch(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    console.log(`[scheduler] ${path} answered ${res.status}`);
  } catch (err) {
    console.log(`[scheduler] ${path} failed: ${err}`);
  }
}

// Local (Uzbekistan) wall clock for a UTC date.
function local(d) {
  const t = new Date(d.getTime() + TZ_OFFSET_H * 3600_000);
  return { dow: t.getUTCDay(), h: t.getUTCHours(), m: t.getUTCMinutes(), key: t.toISOString().slice(0, 16) };
}

const JOBS = [
  { name: 'purge', h: 3, m: 15, run: () => npmRun('purge:expired') },
  { name: 'classifier', h: 4, m: 0, run: () => npmRun('classifier:update') },
  { name: 'daily', h: 6, m: 15, run: () => callRoute('/api/cron/daily') },
];

const fired = new Set();
console.log('[scheduler] started, times are UTC+5');
setInterval(() => {
  const now = local(new Date());
  for (const job of JOBS) {
    if (job.dow !== undefined && job.dow !== now.dow) continue;
    if (job.h !== now.h || job.m !== now.m) continue;
    const id = `${job.name}@${now.key}`;
    if (fired.has(id)) continue;
    fired.add(id);
    void job.run();
  }
}, 20_000);
