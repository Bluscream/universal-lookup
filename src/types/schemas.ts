import { z } from 'zod';

// ---- Lookup type enum ----
export const LookupTypeSchema = z.enum(['tel', 'ip', 'email', 'location', 'parcel']);

// ---- Route params ----
export const LookupParamsSchema = z.object({
  type: LookupTypeSchema,
  query: z.string().min(1, 'Query is required'),
});

// ---- Query string params ----
export const LookupQuerySchema = z.object({
  raw: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
  fresh: z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean()).optional(),
});

// ---- Response schemas ----
export const RequestInfoSchema = z.object({
  time: z.string(),
  ip: z.string(),
  type: LookupTypeSchema,
  query: z.string(),
});

export const LookupResponseSchema = z.object({
  lookup_time: z.string(),
  success: z.boolean(),
  response: z.record(z.unknown()),
  errors: z.record(z.string()),
  raw: z.record(z.unknown()),
  request: RequestInfoSchema,
});

// ---- Type exports ----
export type LookupParamsInput = z.infer<typeof LookupParamsSchema>;
export type LookupQueryInput = z.infer<typeof LookupQuerySchema>;
