// The background worker: BullMQ processors, the scheduler and /healthz. See apps/worker/README.md.
//   npm run dev:worker | build:worker | start:worker   (from the repository root)
import './root.js'; // must precede everything that reads process.cwd() or .env
import '@tasnivo/domain/load-env';
import { Logger } from '@nestjs/common';
import { workerConfig } from './config.js';
import { JsonLogger, reason } from './logger.js';
import { startWorker, stopWorker } from './worker.js';

const logger = new JsonLogger();
const log = new Logger('Worker');
Logger.overrideLogger(logger);

try {
  const config = workerConfig();
  const app = await startWorker(config, { logger });
  log.log({ msg: 'worker started', pid: process.pid, cwd: process.cwd(), auditConcurrency: config.auditConcurrency, port: config.port });

  let stopping = false;
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    log.log({ msg: 'shutting down: no new jobs, waiting for running ones', signal, graceMs: config.shutdownGraceMs });
    void stopWorker(app, config.shutdownGraceMs).then(
      (clean) => {
        if (clean) log.log({ msg: 'worker stopped' });
        else log.warn({ msg: 'grace period over; exiting with jobs still running (an audit resumes from its watermark)' });
        process.exit(0);
      },
      (error: unknown) => {
        log.error({ msg: 'shutdown failed', error: reason(error) });
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  log.error({ msg: 'worker failed to start', error: reason(error) });
  process.exit(1);
}
