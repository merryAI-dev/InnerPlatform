import { z } from 'zod';

const NON_EMPTY_STRING = z.string().trim().min(1);

export const projectUpsertSchema = z.object({
  id: NON_EMPTY_STRING,
  name: NON_EMPTY_STRING,
  expectedVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export const ledgerUpsertSchema = z.object({
  id: NON_EMPTY_STRING,
  projectId: NON_EMPTY_STRING,
  name: NON_EMPTY_STRING,
  expectedVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export const transactionUpsertSchema = z.object({
  id: NON_EMPTY_STRING,
  projectId: NON_EMPTY_STRING,
  ledgerId: NON_EMPTY_STRING,
  counterparty: NON_EMPTY_STRING,
  state: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export const transactionStateSchema = z.object({
  newState: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']),
  reason: z.string().trim().optional(),
  expectedVersion: z.number().int().positive(),
});

export const commentCreateSchema = z.object({
  id: NON_EMPTY_STRING.optional(),
  content: NON_EMPTY_STRING,
  authorName: NON_EMPTY_STRING.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export const evidenceCreateSchema = z.object({
  id: NON_EMPTY_STRING.optional(),
  fileName: NON_EMPTY_STRING,
  fileType: NON_EMPTY_STRING,
  fileSize: z.number().int().nonnegative(),
  category: NON_EMPTY_STRING,
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).passthrough();

export const memberRoleUpdateSchema = z.object({
  role: z.enum(['admin', 'finance', 'pm', 'viewer', 'auditor', 'tenant_admin', 'support', 'security']),
  reason: z.string().trim().min(1).max(500).optional(),
});

export function parseWithSchema(schema, body, fallbackMessage = 'Invalid request body') {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const message = parsed.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : 'body';
    return `${path}: ${issue.message}`;
  }).join('; ');

  const error = new Error(message || fallbackMessage);
  error.statusCode = 400;
  throw error;
}
