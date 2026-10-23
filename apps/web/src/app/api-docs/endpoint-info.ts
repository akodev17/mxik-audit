// What an endpoint card on /api-docs shows, read from the public API contract (@tasnivo/contracts),
// so the page and /api/v1/openapi.json cannot disagree on method, path, parameters or error codes.
import { publicApi } from '@tasnivo/contracts/modules/public-api';

export type ParamPlace = 'path' | 'query' | 'form' | 'file';
export type EndpointParam = { name: string; where: ParamPlace; required: boolean };
export type EndpointInfo = {
  method: string;
  path: string;
  success: number;
  idempotent: boolean;
  paginated: boolean;
  errors: readonly string[];
  params: EndpointParam[];
};

export type DocEndpoint = 'check' | 'list' | 'upload' | 'report';

const SOURCE = { check: publicApi.check, list: publicApi.listCatalogs, upload: publicApi.uploadCatalog, report: publicApi.report } as const;

type Shape = Record<string, { isOptional: () => boolean }>;

/** The keys of a zod object, each with whether it may be left out. */
function fields(schema: unknown, where: ParamPlace): EndpointParam[] {
  const shape = (schema as { shape?: Shape } | undefined)?.shape;
  if (!shape) return [];
  return Object.entries(shape).map(([name, field]) => ({ name, where, required: !field.isOptional() }));
}

export function endpointInfo(id: DocEndpoint): EndpointInfo {
  const def = SOURCE[id];
  const meta = def.publicApi;
  const multipart = 'multipart' in def ? def.multipart : undefined;
  const params = [
    ...fields('params' in def ? def.params : undefined, 'path'),
    ...fields('query' in def ? def.query : undefined, 'query'),
    ...Object.entries(multipart?.files ?? {}).map(([name, f]) => ({ name, where: 'file' as const, required: f.required })),
    ...fields(multipart?.fields, 'form'),
  ];
  return { method: def.method, path: def.path, success: meta.success, idempotent: meta.idempotent, paginated: meta.paginated, errors: meta.errors, params };
}
