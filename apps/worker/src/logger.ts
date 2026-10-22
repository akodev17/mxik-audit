// One JSON object per line on stdout (errors on stderr), so container logs can be filtered by
// catalogId, listId or jobId. Nest's Logger instances write through this once it is the app logger:
//   this.log.log({ msg: 'audit finished', catalogId, jobId, durationMs })
import type { LoggerService } from '@nestjs/common';

type Level = 'error' | 'warn' | 'info' | 'debug' | 'verbose' | 'fatal';

export function logLine(level: Level, message: unknown, context?: string, extra: Record<string, unknown> = {}): string {
  const fields = message !== null && typeof message === 'object' && !(message instanceof Error)
    ? { ...(message as Record<string, unknown>) }
    : { msg: message instanceof Error ? message.message : String(message) };
  return JSON.stringify({ t: new Date().toISOString(), level, ...(context ? { ctx: context } : {}), ...fields, ...extra });
}

/** Nest passes the context last; an error's stack comes before it for error(). */
function split(params: unknown[]): { context?: string; rest: unknown[] } {
  const last = params[params.length - 1];
  return typeof last === 'string' ? { context: last, rest: params.slice(0, -1) } : { rest: params };
}

export class JsonLogger implements LoggerService {
  constructor(private readonly write: (line: string, stream: 'out' | 'err') => void = (line, stream) => {
    (stream === 'err' ? process.stderr : process.stdout).write(`${line}\n`);
  }) {}

  log(message: unknown, ...params: unknown[]): void {
    this.emit('info', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('verbose', message, params);
  }
  fatal(message: unknown, ...params: unknown[]): void {
    this.emit('fatal', message, params, 'err');
  }
  error(message: unknown, ...params: unknown[]): void {
    const { context, rest } = split(params);
    const stack = message instanceof Error ? message.stack : typeof rest[0] === 'string' ? rest[0] : undefined;
    this.write(logLine('error', message, context, stack ? { stack } : {}), 'err');
  }

  private emit(level: Level, message: unknown, params: unknown[], stream: 'out' | 'err' = 'out'): void {
    this.write(logLine(level, message, split(params).context), stream);
  }
}

/** For a log field: the message of whatever was thrown. */
export function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
