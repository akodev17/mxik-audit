import { Injectable, type CallHandler, type NestInterceptor } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/**
 * Sends every handler result as JSON. Nest's Express adapter answers null with an empty body and a
 * boolean, number or string as text; several contract answers are exactly that (`null` for a
 * refused two-factor code, `true`, a count, a one-time state). Wrapped in an object whose toJSON
 * is the value, `res.json` writes `null`, `true`, `3` or `"state"` with application/json.
 */
@Injectable()
export class JsonAnswerInterceptor implements NestInterceptor {
  intercept(_ctx: unknown, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((value: unknown) => (value !== null && typeof value === 'object' ? value : { toJSON: () => value ?? null })));
  }
}
