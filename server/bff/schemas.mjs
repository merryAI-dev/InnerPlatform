import { z } from 'zod';

const NON_EMPTY_STRING = z.string().trim().min(1);
const RECORD_UNKNOWN = z.record(z.string(), z.unknown());

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
}).strict();

export const commentCreateSchema = z.object({
  id: NON_EMPTY_STRING.optional(),
  content: NON_EMPTY_STRING,
  authorName: NON_EMPTY_STRING.optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const evidenceCreateSchema = z.object({
  id: NON_EMPTY_STRING.optional(),
  fileName: NON_EMPTY_STRING,
  fileType: NON_EMPTY_STRING,
  fileSize: z.number().int().nonnegative(),
  category: NON_EMPTY_STRING,
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED']).optional(),
  source: z.enum(['MANUAL', 'PLATFORM_UPLOAD', 'DRIVE_SYNC']).optional(),
  driveFileId: NON_EMPTY_STRING.optional(),
  driveFolderId: NON_EMPTY_STRING.optional(),
  driveFolderName: NON_EMPTY_STRING.optional(),
  webViewLink: NON_EMPTY_STRING.optional(),
  mimeType: NON_EMPTY_STRING.optional(),
  parserCategory: NON_EMPTY_STRING.optional(),
  parserConfidence: z.number().min(0).max(1).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
}).strict();

export const projectDriveRootLinkSchema = z.object({
  value: NON_EMPTY_STRING,
}).strict();

export const projectTrashSchema = z.object({
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
}).strict();

export const projectRestoreSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const googleSheetImportPreviewSchema = z.object({
  value: NON_EMPTY_STRING,
  sheetName: NON_EMPTY_STRING.optional(),
}).strict();

export const googleSheetImportAnalyzeSchema = z.object({
  spreadsheetTitle: z.string().trim().optional(),
  selectedSheetName: NON_EMPTY_STRING,
  matrix: z.array(z.array(z.string())).min(1),
}).strict();

const settlementKernelImportRowSchema = z.object({
  tempId: NON_EMPTY_STRING,
  sourceTxId: z.string().trim().optional(),
  entryKind: z.enum(['STANDARD', 'EXPENSE', 'DEPOSIT', 'ADJUSTMENT']).optional(),
  cells: z.array(z.string()),
  error: z.string().trim().optional(),
  reviewHints: z.array(z.string().trim()).optional(),
  reviewRequiredCellIndexes: z.array(z.number().int().nonnegative()).optional(),
  reviewStatus: z.enum(['pending', 'confirmed']).optional(),
  reviewFingerprint: z.string().trim().optional(),
  reviewConfirmedAt: z.string().trim().optional(),
  userEditedCells: z.array(z.number().int().nonnegative()).optional(),
}).strict();

const weeklyExpenseSaveSyncPlanSchema = z.object({
  yearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  weekNo: z.number().int().positive(),
  amounts: z.record(z.string().trim().min(1), z.number()),
  reviewPendingCount: z.number().int().nonnegative(),
}).strict();

export const portalWeeklyExpenseSaveSchema = z.object({
  projectId: NON_EMPTY_STRING,
  activeSheetId: NON_EMPTY_STRING,
  activeSheetName: NON_EMPTY_STRING.max(200),
  order: z.number().int().nonnegative(),
  expectedVersion: z.number().int().nonnegative(),
  rows: z.array(settlementKernelImportRowSchema),
  syncPlan: z.array(weeklyExpenseSaveSyncPlanSchema),
}).strict();

export const portalWeeklySubmissionSubmitSchema = z.object({
  projectId: NON_EMPTY_STRING,
  yearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  weekNo: z.number().int().positive(),
  transactionIds: z.array(NON_EMPTY_STRING),
}).strict();

export const cashflowWeekCloseSchema = z.object({
  projectId: NON_EMPTY_STRING,
  yearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  weekNo: z.number().int().positive(),
}).strict();

export const cashflowWeekUpsertSchema = z.object({
  projectId: NON_EMPTY_STRING,
  yearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  weekNo: z.number().int().positive(),
  mode: z.enum(['projection', 'actual']),
  amounts: z.record(z.string().trim().min(1), z.number()),
}).strict();

const varianceFlagSchema = z.object({
  status: z.enum(['OPEN', 'REPLIED', 'RESOLVED']),
  reason: NON_EMPTY_STRING,
  flaggedBy: NON_EMPTY_STRING,
  flaggedByUid: z.string().trim().max(200).optional(),
  flaggedAt: NON_EMPTY_STRING,
  pmReply: z.string().trim().optional(),
  pmRepliedBy: z.string().trim().optional(),
  pmRepliedByUid: z.string().trim().max(200).optional(),
  pmRepliedAt: z.string().trim().optional(),
  resolvedBy: z.string().trim().optional(),
  resolvedByUid: z.string().trim().max(200).optional(),
  resolvedAt: z.string().trim().optional(),
}).strict();

const varianceFlagEventSchema = z.object({
  id: NON_EMPTY_STRING,
  action: z.enum(['FLAG', 'REPLY', 'RESOLVE']),
  actor: NON_EMPTY_STRING,
  actorUid: z.string().trim().max(200).optional(),
  content: NON_EMPTY_STRING,
  timestamp: NON_EMPTY_STRING,
}).strict();

export const cashflowWeekVarianceFlagSchema = z.object({
  sheetId: NON_EMPTY_STRING,
  varianceFlag: varianceFlagSchema.nullish(),
  varianceHistory: z.array(varianceFlagEventSchema),
}).strict();

export const portalBankStatementHandoffSchema = z.object({
  projectId: NON_EMPTY_STRING,
  activeSheetId: NON_EMPTY_STRING,
  activeSheetName: NON_EMPTY_STRING.max(200),
  order: z.number().int().nonnegative(),
  columns: z.array(z.string()),
  rows: z.array(settlementKernelImportRowSchema),
}).strict();

const bankImportManualFieldsSchema = z.object({
  expenseAmount: z.number().finite().optional(),
  budgetCategory: z.string().trim().optional(),
  budgetSubCategory: z.string().trim().optional(),
  cashflowLineId: z.enum([
    'MYSC_PREPAY_IN',
    'SALES_IN',
    'SALES_VAT_IN',
    'TEAM_SUPPORT_IN',
    'BANK_INTEREST_IN',
    'DIRECT_COST_OUT',
    'INPUT_VAT_OUT',
    'MYSC_LABOR_OUT',
    'MYSC_PROFIT_OUT',
    'SALES_VAT_OUT',
    'TEAM_SUPPORT_OUT',
    'BANK_INTEREST_OUT',
  ]).optional(),
  cashflowCategory: z.enum([
    'CONTRACT_PAYMENT',
    'INTERIM_PAYMENT',
    'FINAL_PAYMENT',
    'LABOR_COST',
    'OUTSOURCING',
    'EQUIPMENT',
    'TRAVEL',
    'SUPPLIES',
    'COMMUNICATION',
    'RENT',
    'UTILITY',
    'TAX_PAYMENT',
    'VAT_REFUND',
    'INSURANCE',
    'MISC_INCOME',
    'MISC_EXPENSE',
  ]).optional(),
  memo: z.string().trim().optional(),
  evidenceCompletedDesc: z.string().optional(),
}).strict();

const bankImportSnapshotSchema = z.object({
  accountNumber: NON_EMPTY_STRING,
  dateTime: NON_EMPTY_STRING,
  counterparty: NON_EMPTY_STRING,
  memo: NON_EMPTY_STRING,
  signedAmount: z.number(),
  balanceAfter: z.number(),
}).strict();

export const portalExpenseIntakeBulkUpsertItemSchema = z.object({
  id: NON_EMPTY_STRING,
  sourceTxId: NON_EMPTY_STRING,
  bankFingerprint: NON_EMPTY_STRING,
  bankSnapshot: bankImportSnapshotSchema,
  matchState: z.enum(['AUTO_CONFIRMED', 'PENDING_INPUT', 'REVIEW_REQUIRED', 'IGNORED']),
  manualFields: bankImportManualFieldsSchema,
  lastUploadBatchId: NON_EMPTY_STRING,
  createdAt: NON_EMPTY_STRING,
  updatedAt: NON_EMPTY_STRING,
  updatedBy: NON_EMPTY_STRING,
}).strict();

export const portalExpenseIntakeBulkUpsertSchema = z.object({
  projectId: NON_EMPTY_STRING,
  items: z.array(portalExpenseIntakeBulkUpsertItemSchema),
}).strict();

const portalExpenseIntakeUpdatesSchema = z.object({
  manualFields: bankImportManualFieldsSchema.optional(),
  existingExpenseSheetId: NON_EMPTY_STRING.nullish(),
  existingExpenseRowTempId: NON_EMPTY_STRING.nullish(),
  matchState: z.enum(['AUTO_CONFIRMED', 'PENDING_INPUT', 'REVIEW_REQUIRED', 'IGNORED']).optional(),
  projectionStatus: z.enum(['NOT_PROJECTED', 'PROJECTED', 'PROJECTED_WITH_PENDING_EVIDENCE']).optional(),
  evidenceStatus: z.enum(['MISSING', 'PARTIAL', 'COMPLETE']).optional(),
  reviewReasons: z.array(NON_EMPTY_STRING).optional(),
  lastUploadBatchId: NON_EMPTY_STRING.optional(),
}).strict();

export const portalExpenseIntakeDraftSaveSchema = z.object({
  projectId: NON_EMPTY_STRING,
  intakeId: NON_EMPTY_STRING,
  updates: portalExpenseIntakeUpdatesSchema,
}).strict();

export const portalExpenseIntakeProjectSchema = z.object({
  projectId: NON_EMPTY_STRING,
  intakeId: NON_EMPTY_STRING,
  updates: portalExpenseIntakeUpdatesSchema.optional(),
}).strict();

const portalExpenseIntakeEvidenceSyncUpdatesSchema = z.object({
  manualFields: z.object({
    evidenceCompletedDesc: z.string().optional(),
  }).strict().optional(),
}).strict().optional();

export const portalExpenseIntakeEvidenceSyncSchema = z.object({
  projectId: NON_EMPTY_STRING,
  intakeId: NON_EMPTY_STRING,
  updates: portalExpenseIntakeEvidenceSyncUpdatesSchema,
}).strict();

export const projectSheetSourceUploadSchema = z.object({
  sourceType: z.enum(['usage', 'budget', 'evidence_rules', 'cashflow', 'bank_statement']),
  sheetName: NON_EMPTY_STRING.max(200),
  fileName: NON_EMPTY_STRING.max(300),
  mimeType: NON_EMPTY_STRING.max(200),
  fileSize: z.number().int().nonnegative(),
  contentBase64: NON_EMPTY_STRING,
  rowCount: z.number().int().nonnegative(),
  columnCount: z.number().int().nonnegative(),
  matchedColumns: z.array(z.string().trim().max(300)).max(80).optional(),
  unmatchedColumns: z.array(z.string().trim().max(300)).max(80).optional(),
  previewMatrix: z.array(z.array(z.string().max(1000)).max(24)).max(60).optional(),
  applyTarget: z.string().trim().max(120).optional(),
}).strict();

export const clientErrorIngestSchema = z.object({
  eventType: z.enum(['exception', 'message']).optional(),
  message: NON_EMPTY_STRING.max(4000),
  name: z.string().trim().max(200).optional(),
  stack: z.string().max(16000).optional(),
  level: z.enum(['info', 'warning', 'error', 'fatal']).optional(),
  source: NON_EMPTY_STRING.max(120),
  route: z.string().trim().max(500).optional(),
  href: z.string().trim().max(2000).optional(),
  clientRequestId: z.string().trim().max(200).optional(),
  fingerprint: z.array(z.string().trim().max(200)).max(8).optional(),
  tags: RECORD_UNKNOWN.optional(),
  extra: RECORD_UNKNOWN.optional(),
  occurredAt: z.string().trim().max(100).optional(),
}).strict();

export const projectRequestContractAnalyzeSchema = z.object({
  fileName: NON_EMPTY_STRING.max(300),
  documentText: z.string().max(200000).optional(),
}).strict();

export const projectRequestContractUploadSchema = z.object({
  fileName: NON_EMPTY_STRING.max(300),
  mimeType: NON_EMPTY_STRING.max(200),
  fileSize: z.number().int().nonnegative(),
  contentBase64: NON_EMPTY_STRING,
}).strict();

export const claudeSdkHelpAskSchema = z.object({
  question: NON_EMPTY_STRING.max(2000),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: NON_EMPTY_STRING.max(4000),
    }).strict(),
  ).max(12).optional(),
}).strict();

export const evidenceDriveUploadSchema = z.object({
  fileName: NON_EMPTY_STRING,
  originalFileName: NON_EMPTY_STRING.optional(),
  mimeType: NON_EMPTY_STRING,
  fileSize: z.number().int().nonnegative(),
  contentBase64: NON_EMPTY_STRING,
  category: NON_EMPTY_STRING.optional(),
}).strict();

export const evidenceDriveOverrideSchema = z.object({
  items: z.array(
    z.object({
      driveFileId: NON_EMPTY_STRING,
      category: NON_EMPTY_STRING,
    }).strict(),
  ).min(1),
}).strict();

export const memberRoleUpdateSchema = z.object({
  role: z.enum(['admin', 'finance', 'pm', 'viewer', 'auditor', 'tenant_admin', 'support', 'security']),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

export const memberDeepSyncSchema = memberRoleUpdateSchema;

export const portalSessionProjectSchema = z.object({
  projectId: NON_EMPTY_STRING,
}).strict();

export const portalRegistrationSchema = z.object({
  name: NON_EMPTY_STRING,
  email: NON_EMPTY_STRING,
  role: NON_EMPTY_STRING.optional(),
  projectId: z.string().trim().optional(),
  projectIds: z.array(NON_EMPTY_STRING).min(1),
}).strict();

export const cashflowExportSchema = z.object({
  scope: z.enum(['all', 'single']),
  projectId: z.string().trim().optional(),
  accountType: z.enum(['DEDICATED', 'OPERATING', 'NONE']).optional(),
  basis: z.enum(['공급가액', '공급대가', 'NONE']).optional(),
  startYearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  endYearMonth: z.string().trim().regex(/^\d{4}-\d{2}$/),
  variant: z.enum(['single-project', 'combined', 'multi-sheet']),
}).strict().superRefine((value, ctx) => {
  if (value.scope === 'single' && !value.projectId) {
    ctx.addIssue({
      code: 'custom',
      path: ['projectId'],
      message: 'projectId is required when scope=single',
    });
  }
  if (value.scope === 'all' && value.variant === 'single-project') {
    ctx.addIssue({
      code: 'custom',
      path: ['variant'],
      message: 'single-project variant requires scope=single',
    });
  }
});

export const genericWriteSchema = z.object({
  entityType: NON_EMPTY_STRING,
  entityId: NON_EMPTY_STRING.optional(),
  patch: RECORD_UNKNOWN,
  expectedVersion: z.number().int().nonnegative().optional(),
  options: z.object({
    sync: z.boolean().optional(),
  }).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.patch || Object.keys(value.patch).length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['patch'],
      message: 'patch must include at least one field',
    });
  }
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
