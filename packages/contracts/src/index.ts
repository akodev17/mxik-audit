// @tasnivo/contracts: every endpoint's method, path, auth and zod schemas, by module.
export * from './endpoint';
export * from './common';
export { named, openapi, metaOf, type OpenApiMeta } from './meta';
export { endpoints, allEndpoints, byOperationId, type Endpoints } from './registry';
export { buildOpenApi, DEFAULT_DOC_CONFIG, SESSION_COOKIE, SchemaConverter, type BuildOptions } from './openapi';
export * as publicApiContract from './modules/public-api';

import type { z } from 'zod';
import type { Endpoint, EndpointDef } from './endpoint';

/** What the client sends as the JSON body (zod input type). */
export type BodyOf<E extends EndpointDef> = E['body'] extends z.ZodTypeAny ? z.input<E['body']> : never;
/** Query parameters (zod input type). */
export type QueryOf<E extends EndpointDef> = E['query'] extends z.AnyZodObject ? z.input<E['query']> : never;
/** Path parameters. */
export type ParamsOf<E extends EndpointDef> = E['params'] extends z.AnyZodObject ? z.input<E['params']> : never;
/** The parsed JSON answer (zod output type). */
export type ResponseOf<E extends EndpointDef> = E extends { responds: 'json'; response: infer R extends z.ZodTypeAny } ? z.output<R> : never;
/** Text fields of a multipart request. */
export type FieldsOf<E extends EndpointDef> = E['multipart'] extends { fields: infer F extends z.AnyZodObject } ? z.input<F> : never;

export type AnyEndpoint = Endpoint;
