import type { FastifyInstance, FastifySchema } from 'fastify';
import { z } from 'zod';

/**
 * Route schemas in this codebase are Zod schemas. This plugin:
 *  1. installs a validator compiler that runs `safeParse` (so request.body/query/params are the
 *     *parsed, coerced* values — defaults applied, emails lowercased, etc.)
 *  2. exposes `toOpenApiSchema` for @fastify/swagger so the same Zod schema documents the endpoint.
 */
export function isZodSchema(s: unknown): s is z.ZodType {
  return Boolean(s) && typeof s === 'object' && s !== null && '_zod' in (s as object);
}

export function toOpenApiSchema(schema: FastifySchema): FastifySchema {
  const out: Record<string, unknown> = { ...schema };
  for (const key of ['body', 'querystring', 'params', 'headers'] as const) {
    const s = schema[key];
    if (isZodSchema(s)) {
      out[key] = z.toJSONSchema(s, { target: 'draft-7', io: 'input', unrepresentable: 'any' });
    }
  }
  return out as FastifySchema;
}

export function registerValidation(app: FastifyInstance): void {
  app.setValidatorCompiler(({ schema }) => {
    if (!isZodSchema(schema)) return () => ({ value: undefined });
    return (data: unknown) => {
      const result = schema.safeParse(data);
      if (result.success) return { value: result.data };
      return { error: result.error };
    };
  });
  // We never declare response schemas; serialize with plain JSON.stringify.
  app.setSerializerCompiler(() => (data) => JSON.stringify(data));
}
