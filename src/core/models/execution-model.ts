import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);

export const ExecutionActionSchema = z.enum([
  'request',
  'navigate',
  'click',
  'fill',
  'select',
  'wait',
  'assert',
  'extract',
]);

const targetFields = {
  semanticLabel: nonEmptyString.optional(),
  role: nonEmptyString.optional(),
  text: nonEmptyString.optional(),
  placeholder: nonEmptyString.optional(),
  url: nonEmptyString.optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  query: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
};

export const TargetSchema = z.union([
  z.object({ ...targetFields, semanticLabel: nonEmptyString }).strict(),
  z.object({ ...targetFields, role: nonEmptyString }).strict(),
  z.object({ ...targetFields, text: nonEmptyString }).strict(),
  z.object({ ...targetFields, placeholder: nonEmptyString }).strict(),
  z.object({ ...targetFields, url: nonEmptyString }).strict(),
  z.object({ ...targetFields, attributes: z.record(z.string(), z.string()) }).strict(),
]);

const expectedResultFields = {
  visible: z.boolean().optional(),
  hidden: z.boolean().optional(),
  text: nonEmptyString.optional(),
  url: nonEmptyString.optional(),
  status: z.number().int().min(100).max(599).optional(),
  exists: z.boolean().optional(),
  bodyContains: z.record(z.string(), z.unknown()).optional(),
  bodyField: z.object({ path: nonEmptyString, equals: z.unknown() }).strict().optional(),
  collect: z.enum(['text']).optional(),
};

export const ExpectedResultSchema = z.union([
  z.object({ ...expectedResultFields, visible: z.boolean() }).strict(),
  z.object({ ...expectedResultFields, hidden: z.boolean() }).strict(),
  z.object({ ...expectedResultFields, text: nonEmptyString }).strict(),
  z.object({ ...expectedResultFields, url: nonEmptyString }).strict(),
  z.object({ ...expectedResultFields, status: z.number().int().min(100).max(599) }).strict(),
  z.object({ ...expectedResultFields, exists: z.boolean() }).strict(),
  z.object({ ...expectedResultFields, bodyContains: z.record(z.string(), z.unknown()) }).strict(),
  z
    .object({
      ...expectedResultFields,
      bodyField: z.object({ path: nonEmptyString, equals: z.unknown() }).strict(),
    })
    .strict(),
  z.object({ ...expectedResultFields, collect: z.literal('text') }).strict(),
]);

export const ExecutionStepSchema = z
  .object({
    id: nonEmptyString,
    action: ExecutionActionSchema,
    target: TargetSchema,
    value: nonEmptyString.optional(),
    expected: ExpectedResultSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const ExecutionIntentSchema = z
  .object({
    id: nonEmptyString,
    description: nonEmptyString,
    domain: nonEmptyString,
    steps: z.array(ExecutionStepSchema).min(1),
  })
  .strict();

export type ExecutionAction = z.infer<typeof ExecutionActionSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type ExpectedResult = z.infer<typeof ExpectedResultSchema>;
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;
export type ExecutionIntent = z.infer<typeof ExecutionIntentSchema>;
