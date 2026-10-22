// OpenAPI hints a zod schema cannot carry itself, kept beside the schema instance. Zod methods
// return new instances, so apply these last: `named('Catalog', z.object({...}))`.
import type { ZodTypeAny } from 'zod';
import type { DocConfig } from './endpoint';

type Json = Record<string, unknown>;

export type OpenApiMeta = {
  /** Emitted once under components.schemas and referenced with $ref everywhere else. */
  ref?: string;
  /** Replaces what the converter would emit (a transform whose input it cannot see, a file part). */
  schema?: Json;
  /** Merged into the emitted schema; may depend on the configured limits. */
  extend?: Json | ((config: DocConfig) => Json);
};

const META = new WeakMap<ZodTypeAny, OpenApiMeta>();

export function openapi<T extends ZodTypeAny>(schema: T, meta: OpenApiMeta): T {
  META.set(schema, { ...META.get(schema), ...meta });
  return schema;
}

/** A schema that gets its own entry in components.schemas. */
export function named<T extends ZodTypeAny>(name: string, schema: T): T {
  return openapi(schema, { ref: name });
}

export function metaOf(schema: ZodTypeAny): OpenApiMeta | undefined {
  return META.get(schema);
}
