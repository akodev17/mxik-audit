import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z, ZodTypeAny } from 'zod';
import { ApiError } from './errors';

/**
 * Validates and parses one argument with a zod schema: `@Body(new ZodValidationPipe(SignInBody))`.
 * A mismatch answers 400 `invalid_request` with the issues (path + message) under `issues`;
 * the handler receives the parsed value (defaults applied, unknown keys stripped).
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data as z.infer<S>;
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    const first = issues[0];
    const message = first ? `Invalid request: ${first.path ? `${first.path}: ` : ''}${first.message}` : 'Invalid request.';
    throw new ApiError(400, 'invalid_request', message, {}, { issues });
  }
}
