import { Global, Module } from '@nestjs/common';
import { parseEnv, type AppConfig } from './env';

/** Injection token for the validated AppConfig: `@Inject(APP_CONFIG) config: AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => parseEnv(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
