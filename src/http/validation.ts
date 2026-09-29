import { z } from 'zod';
import { ApiError } from '../errors/ApiError';

/** Parses input with a zod schema, turning failures into the API's 400 error contract. */
export function parse<T extends z.ZodType>(schema: T, input: unknown, location: 'query' | 'body' | 'path'): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  throw ApiError.badRequest(`Request ${location} failed validation`, result.error.issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : undefined,
    issue: issue.code === 'unrecognized_keys' ? `unknown ${location} parameter(s): ${issue.keys.join(', ')}` : issue.message,
  })));
}

export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(500).default(50),
};

export const isoDateTime = z.iso.datetime({ offset: true, message: 'must be an ISO 8601 date-time, e.g. 2026-09-29T06:00:00Z' });

/** Builds a `sort` parameter accepting `field` (ascending) or `-field` (descending). */
export function sortParam<const F extends string>(fields: readonly F[], fallback: NoInfer<`${'' | '-'}${F}`>) {
  const allowed = fields.flatMap((field) => [field, `-${field}`]);
  return z
    .string()
    .default(fallback)
    .refine((value) => allowed.includes(value), { message: `must be one of: ${allowed.join(', ')}` })
    .transform((value) => {
      const descending = value.startsWith('-');
      const field = (descending ? value.slice(1) : value) as F;
      return { field, direction: descending ? (-1 as const) : (1 as const) };
    });
}

export const objectIdParam = z.string().regex(/^[a-f0-9]{24}$/i, 'must be a 24-character hexadecimal id');
