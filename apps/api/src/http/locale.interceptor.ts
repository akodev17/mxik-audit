import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { requestLocale, type ApiRequest } from './request';

/**
 * Resolves the request's locale from the mxik_locale cookie before the handler runs, so services
 * receive it as an argument (`@Locale() locale`) instead of reading cookies, and labels the answer
 * with Content-Language. Guards run before interceptors; they call requestLocale() themselves.
 */
@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() === 'http') {
      const locale = requestLocale(ctx.switchToHttp().getRequest<ApiRequest>());
      ctx.switchToHttp().getResponse<Response>().setHeader('Content-Language', locale);
    }
    return next.handle();
  }
}
