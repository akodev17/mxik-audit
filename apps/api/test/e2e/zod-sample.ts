// A small valid value for a zod schema, so the isolation matrix can send every operation a body
// that passes validation and reaches the ownership check. Required fields only; the matrix
// overrides the id fields and the few strings a refinement or pattern constrains.
import { z, type ZodTypeAny } from 'zod';

export function sample(schema: ZodTypeAny): unknown {
  const def = schema._def as { typeName: z.ZodFirstPartyTypeKind } & Record<string, unknown>;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (schema as z.AnyZodObject).shape as Record<string, ZodTypeAny>;
      return Object.fromEntries(Object.entries(shape).flatMap(([k, v]) => (v.isOptional() ? [] : [[k, sample(v)]])));
    }
    case z.ZodFirstPartyTypeKind.ZodString: {
      const checks = (def['checks'] as { kind: string; value?: number }[] | undefined) ?? [];
      const min = checks.find((c) => c.kind === 'min' || c.kind === 'length')?.value ?? 1;
      if (checks.some((c) => c.kind === 'datetime')) return new Date().toISOString();
      return 'x'.repeat(Math.max(1, min));
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const checks = (def['checks'] as { kind: string; value?: number }[] | undefined) ?? [];
      return checks.find((c) => c.kind === 'min')?.value ?? 1;
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean: return false;
    case z.ZodFirstPartyTypeKind.ZodEnum: return (def['values'] as string[])[0];
    case z.ZodFirstPartyTypeKind.ZodNativeEnum: return Object.values(def['values'] as Record<string, string>)[0];
    case z.ZodFirstPartyTypeKind.ZodLiteral: return def['value'];
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const min = (def['minLength'] as { value: number } | null)?.value ?? 0;
      return Array.from({ length: min }, () => sample(def['type'] as ZodTypeAny));
    }
    case z.ZodFirstPartyTypeKind.ZodUnion:
    case z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion:
    {
      const options = def['options'] as Iterable<ZodTypeAny>;
      return sample([...options][0] as ZodTypeAny);
    }
    case z.ZodFirstPartyTypeKind.ZodNullable: return null;
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodDefault:
      return sample(def['innerType'] as ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodEffects: return sample(def['schema'] as ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodPipeline: return sample(def['in'] as ZodTypeAny);
    case z.ZodFirstPartyTypeKind.ZodLazy: return sample((def['getter'] as () => ZodTypeAny)());
    case z.ZodFirstPartyTypeKind.ZodRecord: return {};
    case z.ZodFirstPartyTypeKind.ZodDate: return new Date().toISOString();
    case z.ZodFirstPartyTypeKind.ZodAny:
    case z.ZodFirstPartyTypeKind.ZodUnknown: return {};
    default: return undefined;
  }
}
