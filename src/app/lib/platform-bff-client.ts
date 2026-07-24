import { featureFlags, parseFeatureFlag } from '../config/feature-flags';
import type {
  AccountType,
  Project,
  ProjectRequest,
  ProjectExecutiveReviewStatus,
  ProjectManagementPlanningReviewStatus,
  ProjectSheetSourceSnapshot,
  ProjectSheetSourceType,
  ProjectRequestContractAnalysis,
  TransactionState,
} from '../data/types';
import { PlatformApiClient } from '../platform/api-client';
import { buildStandardHeaders, type RequestActor } from '../platform/request-context';
import {
  cashflowMutationHeaders,
  type CashflowMutationLease,
} from './cashflow-edit-lease';

export interface PlatformApiRuntimeConfig {
  enabled: boolean;
  baseUrl: string;
}

export interface ActorLike {
  uid: string;
  email?: string;
  role?: string;
  idToken?: string;
  googleAccessToken?: string;
}

export interface UpsertProjectPayload {
  id: string;
  name: string;
  expectedVersion?: number;
  [key: string]: unknown;
}

export interface TrashProjectPayload {
  expectedVersion: number;
  reason?: string;
}

export interface RestoreProjectPayload {
  expectedVersion: number;
}

export interface UpsertLedgerPayload {
  id: string;
  projectId: string;
  name: string;
  expectedVersion?: number;
}

export interface UpsertTransactionPayload {
  id: string;
  projectId: string;
  ledgerId: string;
  counterparty: string;
  expectedVersion?: number;
}

export interface CreateCommentPayload {
  id?: string;
  content: string;
  authorName?: string;
  projectId?: string;
  targetType?: 'transaction' | 'expense_sheet_row';
  sheetRowId?: string;
  fieldKey?: string;
  fieldLabel?: string;
}

export interface CreateEvidencePayload {
  id?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  category: string;
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export interface ProjectRequestContractUploadPayload {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export type BusinessCardConfidence = 'high' | 'medium' | 'low';

export interface BusinessCardExtractedField {
  value: string;
  confidence: BusinessCardConfidence;
  evidence: string;
}

export interface BusinessCardExtractedListField extends BusinessCardExtractedField {}

export interface BusinessCardExtraction {
  name: BusinessCardExtractedField;
  organization: BusinessCardExtractedField;
  department: BusinessCardExtractedField;
  title: BusinessCardExtractedField;
  role: BusinessCardExtractedField;
  emails: BusinessCardExtractedListField[];
  phones: BusinessCardExtractedListField[];
  website: BusinessCardExtractedField;
  address: BusinessCardExtractedField;
  memo: BusinessCardExtractedField;
  rawText: string;
  warnings: string[];
}

export interface BusinessCardProcessPayload {
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
}

export interface BusinessCardImportResult {
  importId: string;
  status: 'needs_review' | 'saved' | 'failed';
  extracted: BusinessCardExtraction;
  error?: { code?: string; message?: string } | null;
}

export interface BusinessCardImportListItem {
  id: string;
  status: 'needs_review' | 'saved' | 'failed';
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy?: string;
  uploadedByEmail?: string;
  createdAt: string;
  updatedAt: string;
  extracted: BusinessCardExtraction | null;
  contactId?: string | null;
  error?: { code?: string; message?: string } | null;
}

export interface BusinessCardConfirmPayload {
  name: string;
  organization: string;
  department: string;
  title: string;
  role: string;
  emails: string[];
  phones: string[];
  website: string;
  address: string;
  memo: string;
}

export interface BusinessCardConfirmResult {
  ok: boolean;
  importId: string;
  contactId: string;
  status: 'saved';
}

export interface ContactSearchResult {
  id: string;
  name: string;
  organization: string;
  department?: string;
  title?: string;
  role?: string;
  emails: string[];
  phones: string[];
  website?: string;
  address?: string;
  memo?: string;
  score: number;
  updatedAt?: string;
}

export interface ContactUpdateResult {
  ok: boolean;
  contact: ContactSearchResult;
}

export interface ProvisionProjectEvidenceDriveRootResult {
  projectId: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  version: number;
  updatedAt: string;
}

export interface LinkProjectEvidenceDriveRootResult extends ProvisionProjectEvidenceDriveRootResult {}

export interface GoogleSheetPreviewSheet {
  sheetId: number;
  title: string;
  index: number;
}

export interface GoogleSheetImportPreviewResult {
  spreadsheetId: string;
  spreadsheetTitle: string;
  selectedSheetName: string;
  availableSheets: GoogleSheetPreviewSheet[];
  matrix: string[][];
}

export interface GoogleSheetMigrationAnalysisSuggestion {
  sourceHeader: string;
  platformField: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface GoogleSheetMigrationAnalysisResult {
  provider: 'anthropic' | 'heuristic';
  model: string;
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  likelyTarget: string;
  usageTips: string[];
  warnings: string[];
  nextActions: string[];
  suggestedMappings: GoogleSheetMigrationAnalysisSuggestion[];
  headerPreview?: string[];
}

export interface ProjectSheetSourceUploadPayload {
  sourceType: ProjectSheetSourceType;
  sheetName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
  rowCount: number;
  columnCount: number;
  matchedColumns?: string[];
  unmatchedColumns?: string[];
  previewMatrix?: string[][];
  applyTarget?: string;
}

export interface ProjectRequestContractAnalysisResult extends ProjectRequestContractAnalysis {}

export interface ProjectRequestRegistrationNotificationResult {
  ok: boolean;
  enabled: boolean;
  delivered: boolean;
  requestId: string;
  projectId: string | null;
  reason?: string;
}

export interface ProjectExecutiveReviewPayload {
  requestId?: string;
  reviewStatus: ProjectExecutiveReviewStatus;
  reviewComment?: string;
  reviewerName?: string;
  projectCode?: string;
}

export interface ProjectExecutiveReviewResult {
  ok: boolean;
  projectId: string;
  requestId: string | null;
  reviewStatus: ProjectExecutiveReviewStatus;
  reviewedAt?: string;
  slackDelivered?: boolean;
  slackReason?: string | null;
}

export interface ProjectExecutiveReviewResubmitPayload {
  requestId?: string;
  reviewComment?: string;
  reviewerName?: string;
}

export interface ProjectExecutiveReviewResubmitResult {
  ok: boolean;
  projectId: string;
  requestId: string | null;
  reviewStatus: 'PENDING';
  reviewedAt?: string;
}

export interface ProjectManagementPlanningReviewPayload {
  requestId?: string;
  reviewStatus: Exclude<ProjectManagementPlanningReviewStatus, 'PENDING'>;
  reviewComment?: string;
  reviewerName?: string;
  projectCode?: string;
}

export interface ProjectManagementPlanningReviewResult {
  ok: boolean;
  projectId: string;
  requestId: string | null;
  reviewStatus: Exclude<ProjectManagementPlanningReviewStatus, 'PENDING'>;
  reviewedAt?: string;
}

export type AuthGovernanceDriftFlag =
  | 'missing_auth'
  | 'missing_canonical_member'
  | 'legacy_only'
  | 'duplicate_member_docs'
  | 'legacy_role_mismatch'
  | 'claim_mismatch'
  | 'bootstrap_admin_not_adopted';

export interface AuthGovernanceMemberSnapshot {
  docId: string;
  uid: string;
  email: string;
  role: string;
  status: string | null;
  name: string;
}

export interface AuthGovernanceProjectPermission {
  id: string;
  name: string;
}

export interface AuthGovernancePermissionOverview {
  isActive: boolean;
  accessibleProjects: AuthGovernanceProjectPermission[];
  organizationHeadProjects: AuthGovernanceProjectPermission[];
  canRequestCashflowClose: boolean;
  canApproveProjectRegistration: boolean;
  canDecideCashflowReopen: boolean;
}

export interface AuthGovernanceUserRow {
  identityKey: string;
  email: string;
  authUid: string | null;
  displayName: string;
  authDisabled: boolean;
  bootstrapAdmin: boolean;
  claimRole: string | null;
  claimTenantId: string | null;
  canonicalMember: AuthGovernanceMemberSnapshot | null;
  legacyMembers: AuthGovernanceMemberSnapshot[];
  effectiveRole: string;
  driftFlags: AuthGovernanceDriftFlag[];
  needsDeepSync: boolean;
  permissionOverview?: AuthGovernancePermissionOverview;
}

export interface AuthGovernanceSummary {
  total: number;
  needsDeepSync: number;
  missingAuth: number;
  missingCanonicalMember: number;
  duplicateMemberDocs: number;
  bootstrapCandidates: number;
}

export interface AuthGovernanceDirectoryResult {
  items: AuthGovernanceUserRow[];
  summary: AuthGovernanceSummary;
}

export interface AuthGovernanceDeepSyncResult {
  identityKey: string;
  email: string;
  canonicalDocId: string;
  role: string;
  mirroredLegacyCount: number;
  claimsUpdated: boolean;
  updatedAt: string;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeProjectExecutiveReviewPayload(
  payload: ProjectExecutiveReviewPayload,
): ProjectExecutiveReviewPayload {
  const requestId = normalizeOptionalText(payload.requestId);
  const reviewComment = normalizeOptionalText(payload.reviewComment);
  const reviewerName = normalizeOptionalText(payload.reviewerName);
  const projectCode = normalizeOptionalText(payload.projectCode);
  return {
    ...(requestId ? { requestId } : {}),
    reviewStatus: payload.reviewStatus,
    ...(reviewComment ? { reviewComment } : {}),
    ...(reviewerName ? { reviewerName } : {}),
    ...(projectCode ? { projectCode } : {}),
  };
}

function normalizeProjectExecutiveReviewResubmitPayload(
  payload: ProjectExecutiveReviewResubmitPayload,
): ProjectExecutiveReviewResubmitPayload {
  const requestId = normalizeOptionalText(payload.requestId);
  const reviewComment = normalizeOptionalText(payload.reviewComment);
  const reviewerName = normalizeOptionalText(payload.reviewerName);
  return {
    ...(requestId ? { requestId } : {}),
    ...(reviewComment ? { reviewComment } : {}),
    ...(reviewerName ? { reviewerName } : {}),
  };
}

function normalizeProjectManagementPlanningReviewPayload(
  payload: ProjectManagementPlanningReviewPayload,
): ProjectManagementPlanningReviewPayload {
  const requestId = normalizeOptionalText(payload.requestId);
  const reviewComment = normalizeOptionalText(payload.reviewComment);
  const reviewerName = normalizeOptionalText(payload.reviewerName);
  const projectCode = normalizeOptionalText(payload.projectCode);
  return {
    ...(requestId ? { requestId } : {}),
    reviewStatus: payload.reviewStatus,
    ...(reviewComment ? { reviewComment } : {}),
    ...(reviewerName ? { reviewerName } : {}),
    ...(projectCode ? { projectCode } : {}),
  };
}

function normalizeSuggestedMappings(value: unknown): GoogleSheetMigrationAnalysisSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const sourceHeader = typeof item.sourceHeader === 'string' ? item.sourceHeader.trim() : '';
      const platformField = typeof item.platformField === 'string' ? item.platformField.trim() : '';
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low'
        ? item.confidence
        : 'medium';
      if (!sourceHeader || !platformField || !reason) return null;
      return {
        sourceHeader,
        platformField,
        confidence,
        reason,
      } satisfies GoogleSheetMigrationAnalysisSuggestion;
    })
    .filter((item): item is GoogleSheetMigrationAnalysisSuggestion => Boolean(item));
}

function normalizeAiConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizeProjectRequestTextSuggestion(value: unknown) {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    value: typeof raw.value === 'string' ? raw.value.trim() : '',
    confidence: normalizeAiConfidence(raw.confidence),
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

function normalizeProjectRequestNumberSuggestion(value: unknown) {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    value: typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : null,
    confidence: normalizeAiConfidence(raw.confidence),
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

export function normalizeGoogleSheetMigrationAnalysisResult(
  value: unknown,
): GoogleSheetMigrationAnalysisResult {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    provider: raw.provider === 'anthropic' ? 'anthropic' : 'heuristic',
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unavailable',
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : 'AI 분석 결과를 확인할 수 없어 기본 가이드를 표시합니다.',
    confidence: raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'medium',
    likelyTarget: typeof raw.likelyTarget === 'string' && raw.likelyTarget.trim() ? raw.likelyTarget.trim() : 'unknown',
    usageTips: normalizeStringArray(raw.usageTips),
    warnings: normalizeStringArray(raw.warnings),
    nextActions: normalizeStringArray(raw.nextActions),
    suggestedMappings: normalizeSuggestedMappings(raw.suggestedMappings),
    headerPreview: normalizeStringArray(raw.headerPreview),
  };
}

export function normalizeProjectRequestContractAnalysisResult(
  value: unknown,
): ProjectRequestContractAnalysisResult {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields as Record<string, unknown> : {};
  return {
    provider: raw.provider === 'anthropic' ? 'anthropic' : 'heuristic',
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : 'unavailable',
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : '계약서 초안을 확인할 수 없어 직접 입력이 필요합니다.',
    warnings: normalizeStringArray(raw.warnings),
    nextActions: normalizeStringArray(raw.nextActions),
    extractedAt: typeof raw.extractedAt === 'string' && raw.extractedAt.trim()
      ? raw.extractedAt.trim()
      : new Date().toISOString(),
    fields: {
      officialContractName: normalizeProjectRequestTextSuggestion(fields.officialContractName),
      suggestedProjectName: normalizeProjectRequestTextSuggestion(fields.suggestedProjectName),
      clientOrg: normalizeProjectRequestTextSuggestion(fields.clientOrg),
      projectPurpose: normalizeProjectRequestTextSuggestion(fields.projectPurpose),
      description: normalizeProjectRequestTextSuggestion(fields.description),
      contractStart: normalizeProjectRequestTextSuggestion(fields.contractStart),
      contractEnd: normalizeProjectRequestTextSuggestion(fields.contractEnd),
      contractAmount: normalizeProjectRequestNumberSuggestion(fields.contractAmount),
      salesVatAmount: normalizeProjectRequestNumberSuggestion(fields.salesVatAmount),
    },
  };
}

function normalizeBusinessCardConfidence(value: unknown): BusinessCardConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizeBusinessCardField(value: unknown): BusinessCardExtractedField {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    value: typeof raw.value === 'string' ? raw.value.trim() : '',
    confidence: normalizeBusinessCardConfidence(raw.confidence),
    evidence: typeof raw.evidence === 'string' ? raw.evidence.trim() : '',
  };
}

function normalizeBusinessCardListField(value: unknown): BusinessCardExtractedListField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeBusinessCardField(item))
    .filter((item) => item.value)
    .slice(0, 8);
}

export function normalizeBusinessCardExtraction(value: unknown): BusinessCardExtraction {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: normalizeBusinessCardField(raw.name),
    organization: normalizeBusinessCardField(raw.organization),
    department: normalizeBusinessCardField(raw.department),
    title: normalizeBusinessCardField(raw.title),
    role: normalizeBusinessCardField(raw.role),
    emails: normalizeBusinessCardListField(raw.emails),
    phones: normalizeBusinessCardListField(raw.phones),
    website: normalizeBusinessCardField(raw.website),
    address: normalizeBusinessCardField(raw.address),
    memo: normalizeBusinessCardField(raw.memo),
    rawText: typeof raw.rawText === 'string' ? raw.rawText.trim() : '',
    warnings: normalizeStringArray(raw.warnings),
  };
}

export interface ProvisionTransactionEvidenceDriveResult {
  transactionId: string;
  projectId: string;
  projectFolderId: string;
  projectFolderName: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  syncStatus: 'LINKED';
  version: number;
  updatedAt: string;
}

export interface SyncTransactionEvidenceDriveResult {
  transactionId: string;
  projectId: string;
  folderId: string;
  folderName: string;
  webViewLink: string | null;
  sharedDriveId: string | null;
  evidenceCount: number;
  evidenceCompletedDesc: string | null;
  evidenceCompletedManualDesc?: string | null;
  evidenceAutoListedDesc: string | null;
  evidencePendingDesc: string | null;
  supportPendingDocs: string | null;
  evidenceMissing: string[];
  evidenceStatus: 'MISSING' | 'PARTIAL' | 'COMPLETE';
  lastSyncedAt: string;
  version: number;
  updatedAt: string;
}

export interface UploadTransactionEvidenceDrivePayload {
  fileName: string;
  originalFileName?: string;
  mimeType: string;
  fileSize: number;
  contentBase64: string;
  category?: string;
}

export interface UploadTransactionEvidenceDriveResult extends SyncTransactionEvidenceDriveResult {
  driveFileId: string;
  fileName: string;
  originalFileName?: string;
  webViewLink: string | null;
  category: string;
  parserCategory: string;
  parserConfidence: number;
}

export interface OverrideTransactionEvidenceDriveCategoriesPayload {
  items: Array<{
    driveFileId: string;
    category: string;
  }>;
}

export interface CashflowWeekAmountsPayload {
  yearMonth: string;
  weekNo: number;
  mode: 'projection' | 'actual';
  amounts: Record<string, number>;
}

export interface CashflowWeekAmountsResult {
  ok: boolean;
  commandName: string;
  projectId: string;
  savedLineCount: number;
  projection: CashflowProjectionLine[];
  auditId: string;
}

export interface CashflowProjectionLine {
  yearMonth: string;
  weekNo: number;
  cashflowLine: string;
  amount: number;
}

export interface CashflowActualLine extends CashflowProjectionLine {
  sheetKey: string;
}

export interface CashflowModeReadModel {
  rowTotals: Record<string, number>;
  weeks: Array<{
    weekNo: number;
    amounts: Record<string, number>;
    totalIn: number;
    totalOut: number;
    net: number;
    weekIn: number;
    weekOut: number;
  }>;
  monthTotals: { totalIn: number; totalOut: number; net: number };
}

export interface CashflowRangeBoundary {
  yearMonth: string;
  weekNo: number;
}

export interface CashflowRangeTotals {
  rowTotals: Record<string, number>;
  totalIn: number;
  totalOut: number;
  net: number;
}

export interface CashflowComparisonTotals {
  totalIn: number;
  totalOut: number;
  balance: number;
}

export interface CashflowComparisonWeek {
  weekNo: number;
  amounts: Record<string, number>;
  totalIn: number;
  totalOut: number;
  net: number;
  lines: Array<{
    lineId: string;
    direction: 'IN' | 'OUT';
    projection: number;
    projectionHadValue: boolean;
    actual: number;
    actualHadValue: boolean;
    difference: number;
    mismatch: boolean;
  }>;
  totals: {
    projection: CashflowComparisonTotals;
    actual: CashflowComparisonTotals;
    difference: CashflowComparisonTotals;
  };
}

export interface CashflowComparisonMonth {
  yearMonth: string;
  weeks: CashflowComparisonWeek[];
  rowTotals: Record<string, number>;
  totalIn: number;
  totalOut: number;
  net: number;
  totals: CashflowComparisonWeek['totals'];
}

export interface CashflowProjectionActualComparison {
  projectId: string;
  direction: 'projection_minus_actual';
  asOfDate: string;
  asOfWeek: { yearMonth: string; weekNo: number };
  timeZone: 'Asia/Seoul';
  lineOrder: string[];
  months: CashflowComparisonMonth[];
  ignoredLineIds: string[];
}

export interface CashflowSnapshotResult {
  projectId: string;
  projection: CashflowProjectionLine[];
  actual: CashflowActualLine[];
  comparison: CashflowProjectionActualComparison;
  readModel: {
    range: {
      start: CashflowRangeBoundary;
      end: CashflowRangeBoundary;
      projection: CashflowRangeTotals;
      actual: CashflowRangeTotals;
    };
    months: Array<{
      yearMonth: string;
      projection: CashflowModeReadModel;
      actual: CashflowModeReadModel;
      comparison: CashflowComparisonMonth;
    }>;
  };
}

export type CashflowMonthCloseStatus = 'OPEN' | 'CLOSED' | 'REOPEN_REQUESTED';
export type CashflowMonthReopenDecision = 'APPROVE' | 'REJECT';

export interface CashflowActivityEvent {
  id: string;
  projectId: string;
  runId: string;
  type: 'sheet_refresh' | 'sheet_apply' | 'projection_amount_change' | 'actual_amount_change' | 'projection_completed' | 'actual_completed' | 'admin_closed' | 'sheet_apply_reverted' | 'month_close';
  source?: 'google_sheet_refresh' | 'google_sheet_apply' | 'month_close' | 'manual' | 'revert';
  yearMonth?: string;
  year?: number;
  scope?: 'monthly' | 'annual';
  weekNo?: number;
  mode?: 'projection' | 'actual';
  lineId?: string;
  beforeAmount?: number;
  afterAmount?: number;
  beforeHadValue?: boolean;
  afterHadValue?: boolean;
  appliedLineCount?: number;
  projectionLineCount?: number;
  actualLineCount?: number;
  revertedRunId?: string;
  actorUid?: string;
  actorName?: string;
  actorEmail?: string;
  status?: string;
  sheetName?: string;
  createdAt: string;
}

export interface CashflowMonthCloseCell {
  mode: 'projection' | 'actual';
  weekNo: number;
  cashflowLine: string;
  cellState: 'VALUE' | 'EMPTY';
  amount?: number | null;
  sourceCell?: string | null;
  sourceLabel?: string | null;
}

export interface CashflowMonthCloseConfirmation {
  mode: 'projection' | 'actual';
  weekNo: number;
  cashflowLine: string;
  decision: 'CONFIRMED' | 'NOT_APPLICABLE';
}

export interface CashflowManagementCheck {
  id: 'labor-transfer' | 'profit-vat-after-deposit' | 'negative-projection-balance' | 'future-prepay-over-million';
  status: 'OK' | 'WARNING' | 'REVIEW_REQUIRED';
  title: string;
  detail: string;
  findings?: string[];
}

export interface CashflowManagementConfirmation {
  checkId: CashflowManagementCheck['id'];
  decision: 'CONFIRMED' | 'NOT_APPLICABLE';
}

export interface CashflowMonthCloseDepositScheduleRow {
  weekNo: number;
  taxInvoiceIssuedDate: string;
  expectedDepositDate: string;
  expectedDepositAmount?: number | null;
  actualDepositDate: string;
  actualDepositAmount?: number | null;
  actualSource: 'SHEET' | 'BANK_TRANSACTION' | 'DIRECT_ENTRY' | 'NOT_APPLICABLE';
  decision: 'CONFIRMED' | 'NOT_APPLICABLE';
}

export interface CashflowOpeningBalances {
  selectedYear: number;
  projection: {
    amount: number;
    lineAmounts: Record<string, number>;
    sources: Array<{ year: number; lineAmounts: Record<string, number>; lineStates: Record<string, 'EMPTY' | 'ZERO' | 'VALUE'> }>;
    includedYears: number[];
    excludedWeeklyYears: number[];
  };
  actual: {
    amount: number;
    lineAmounts: Record<string, number>;
    sources: Array<{ year: number; lineAmounts: Record<string, number>; lineStates: Record<string, 'EMPTY' | 'ZERO' | 'VALUE'> }>;
    includedYears: number[];
    excludedWeeklyYears: number[];
  };
}

export interface CashflowMonthCloseDraftInput {
  sourceRevision: string;
  targetRevision: string;
  yearMonth: string;
  depositScheduleRows: CashflowMonthCloseDepositScheduleRow[];
  cells: CashflowMonthCloseCell[];
  confirmations: CashflowMonthCloseConfirmation[];
  managementChecks: CashflowManagementCheck[];
  managementConfirmations: CashflowManagementConfirmation[];
  deadlineSummary: CashflowDeadlineSummary;
}

export interface CashflowDeadlineSummary {
  trackingStartedAt: string | null;
  missedCount: number;
  completedCount: number;
  completedWeeks?: Array<{
    yearMonth: string;
    weekNo: number;
    completedAt: string | null;
    completedBy?: string | null;
  }>;
  weeklyStatuses?: Array<{
    yearMonth: string;
    weekNo: number;
    status: 'COMPLETED' | 'COMPLETED_LATE' | 'MISSED' | 'PENDING';
  }>;
  current: {
    yearMonth: string;
    weekNo: number;
    deadline: string;
    completedAt: string | null;
    completedBy?: string | null;
    status: 'COMPLETED' | 'COMPLETED_LATE' | 'MISSED' | 'PENDING';
  } | null;
}

export interface CashflowMonthCloseDashboard {
  source: {
    kind: 'PINNED_MIRROR' | 'MONTH_CLOSE_SNAPSHOT' | 'MONTH_CLOSE_AMENDED_CURRENT';
    status: string;
    sourceRevision: string;
    targetRevision: string;
    capturedAt: string;
  };
  project: Record<string, unknown>;
  projectMetadata: { businessType: string; accountType: string; settlementStatus: string };
  sheetMetadata: Record<string, unknown>;
  sheetCalculationChecks: Array<{
    mode: 'projection' | 'actual';
    yearMonth: string;
    weekNo: number;
    reported: {
      depositTotal: number | null;
      withdrawalTotal: number | null;
      balance: number | null;
    };
  }>;
  sheetControlTotals: {
    deposit: {
      sourceCell: string;
      value: number | null;
      computed?: number | null;
      matches?: boolean;
    } | null;
    unpaid: {
      sourceCell: string;
      value: number | null;
    } | null;
  };
  sheetDepositScheduleRows: Array<{
    yearMonth: string;
    weekNo: number;
    taxInvoiceIssuedDate: string;
    expectedDepositDate: string;
    expectedDepositAmount?: number | null;
    sourceCells?: Record<string, string>;
  }>;
  depositScheduleRows: Array<Record<string, unknown>>;
  cells: CashflowMonthCloseCell[];
  confirmations: CashflowMonthCloseConfirmation[];
  managementChecks: CashflowManagementCheck[];
  managementConfirmations: CashflowManagementConfirmation[];
  openingBalances?: CashflowOpeningBalances;
  snapshotCompatibility: {
    status: 'LIVE_CURRENT' | 'LIVE_AMENDED' | 'FROZEN_COMPLETE' | 'LEGACY_EVIDENCE_ONLY';
    missingEvidence: Array<'OPENING_BALANCES' | 'LEDGER_WEEKS'>;
  };
  deadlineSummary: CashflowDeadlineSummary;
  monthCloseStatuses?: Array<{
    yearMonth: string;
    status: 'OPEN' | 'CLOSED' | 'REOPEN_REQUESTED' | string;
    sheetCalculationChecks?: CashflowMonthCloseDashboard['sheetCalculationChecks'];
  }>;
  postCloseAdjustment: {
    reason: string;
    changedCount: number;
    changes: Array<{
      mode: 'projection' | 'actual';
      weekNo: number;
      cashflowLine: string;
      beforeAmount: number;
      afterAmount: number;
    }>;
  } | null;
  draftRevision: number | null;
  totals: {
    projection: {
      totalIn: number;
      totalOut: number;
      balance: number;
      rowTotals: Record<string, number>;
      weeks: CashflowModeReadModel['weeks'];
    };
    actual: {
      totalIn: number;
      totalOut: number;
      balance: number;
      rowTotals: Record<string, number>;
      weeks: CashflowModeReadModel['weeks'];
    };
    difference: {
      totalIn: number;
      totalOut: number;
      balance: number;
    };
  };
  comparison: CashflowComparisonMonth | null;
  summary: {
    projectionProgressPercent: number;
    actualProgressPercent: number;
    confirmationProgressPercent: number;
    settlementProgressPercent: number;
    settlementCompletedWeekCount: number;
    settlementTargetWeekCount: number;
    settlementIncompleteWeeks: Array<{
      yearMonth: string;
      weekNo: number;
      totalIn: number;
      totalOut: number;
      balance: number;
      reason: 'DIFFERENCE_REVIEW_REQUIRED' | 'SOURCE_INCOMPLETE';
    }>;
    comparisonMatches: boolean;
    comparisonAsOfDate: string;
    comparisonAsOfWeek: { yearMonth: string; weekNo: number };
    evaluatedBusinessDate: string | null;
    closeDeadline: string | null;
    late: boolean;
  };
  validation: {
    canClose: boolean;
    blockers: Array<{ code: string; message: string; details?: unknown }>;
    warnings: Array<{ code: string; message: string; details?: unknown }>;
  };
  canonical: CashflowSnapshotResult['readModel'] | null;
}

export interface CloseCashflowMonthPayload {
  yearMonth: string;
  expectedRevision: number;
  expectedOpeningBalances: CashflowOpeningBalances;
  closeInput: CashflowMonthCloseDraftInput;
}

export interface RequestCashflowMonthReopenPayload {
  yearMonth: string;
  expectedRevision: number;
  reason: string;
}

export interface DecideCashflowMonthReopenPayload {
  yearMonth: string;
  expectedRevision: number;
  decision: CashflowMonthReopenDecision;
  reason: string;
}

export interface CashflowMonthCloseResult {
  ok: boolean;
  commandName: string;
  projectId: string;
  yearMonth: string;
  status: CashflowMonthCloseStatus;
  revision: number;
  reopenCount: number;
  projectWarningCount: number;
  amendmentCount: number;
  postDeadlineAmendmentWarningCount: number;
  lastAmendmentAt: string | null;
  lastAmendmentByUid: string | null;
  lastAmendmentByName: string | null;
  lastAmendmentReason: string | null;
  lastAmendmentDeadline: string | null;
  lastAmendmentPostDeadline: boolean;
  snapshotHash: string | null;
  previousSnapshotHash: string | null;
  snapshot: Record<string, unknown>;
  previousSnapshot: Record<string, unknown>;
  late: boolean;
  closedAt: string | null;
  closedByUid: string | null;
  closedByName: string | null;
  reopenReason: string | null;
  reopenRequestedAt: string | null;
  reopenRequestedByUid: string | null;
  reopenDecision: CashflowMonthReopenDecision | null;
  reopenDecisionReason: string | null;
  reopenDecidedAt: string | null;
  reopenDecidedByUid: string | null;
  auditId: string | null;
  dashboard?: CashflowMonthCloseDashboard;
}

export interface CashflowMonthCloseQaDateTimeSetting {
  projectId: string;
  active: boolean;
  qaDateTime: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface CashflowWeeklyUpdateCompletionResult {
  ok?: boolean;
  commandName?: string;
  projectId: string;
  yearMonth: string;
  weekNo: number;
  completedAt: string;
  completedBy: string | null;
  alreadyCompleted: boolean;
  status: 'LOCKED' | 'OPEN';
  revision: number;
  reopenCount: number;
  snapshotHash: string;
  sourceRevision: string;
  targetRevision: string;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
}

export interface ProjectCashflowActualSyncResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  projectId: string;
  sourceRows: number;
  sheetCount: number;
  upsertedWeeks: number;
  clearedWeeks: number;
  weeks: Array<{
    yearMonth: string;
    weekNo: number;
    weekStart?: string;
    weekEnd?: string;
    amounts?: Record<string, number>;
  }>;
  cleared: Array<{
    yearMonth: string;
    weekNo: number;
    weekStart?: string;
    weekEnd?: string;
    amounts?: Record<string, number>;
  }>;
  updatedAt: string;
}

export interface CashflowLaborRiskWeek {
  yearMonth: string;
  weekNo: number;
  label: string;
  weekStart: string;
  weekEnd: string;
  weekRange: string;
}

export interface CashflowLaborRiskResult {
  projectId: string;
  asOfDate: string;
  snapshotKind: 'cashflow_labor_risk';
  range: {
    startYearMonth: string;
    endYearMonth: string;
    weekCount: number;
  };
  current: {
    balance: number;
    week: CashflowLaborRiskWeek | null;
  };
  labor: {
    lastMonth: {
      yearMonth: string;
      label: string;
      actualAmount: number;
    };
    latestActualMonth: {
      yearMonth: string;
      label: string;
      actualAmount: number;
    } | null;
    referenceActualAmount: number;
    nextProjection: (CashflowLaborRiskWeek & { amount: number }) | null;
    nextMonthProjection: {
      yearMonth: string;
      label: string;
      isWritten: boolean;
      status: 'written' | 'missing';
      projectionAmount: number;
      laborWeeks: Array<CashflowLaborRiskWeek & { amount: number }>;
    };
    projectionCoverageMonths: Array<{
      yearMonth: string;
      label: string;
      isWritten: boolean;
      status: 'written' | 'missing';
      projectionAmount: number;
      laborWeeks: Array<CashflowLaborRiskWeek & { amount: number }>;
    }>;
    missingProjectionMonths: Array<{
      yearMonth: string;
      label: string;
      referenceActualAmount: number;
      weeks: CashflowLaborRiskWeek[];
    }>;
    balanceAfterNextLabor: number;
  };
  shortage: {
    status: 'ok' | 'warning' | 'danger';
    reliable: boolean;
    week: CashflowLaborRiskWeek | null;
    projectedBalance: number | null;
    shortageAmount: number;
    message: string;
    actions: string[];
  };
  snapshot?: {
    persisted: boolean;
    path: string;
  };
}

export interface BankStatementImportBatchPayload {
  idempotencyKey: string;
  uploadName?: string;
  columns: string[];
  lines: Array<{
    lineIndex: number;
    sourceLineKey: string;
    transactionDate: string;
    counterparty: string;
    memo: string;
    signedAmount: number | null;
    balanceAfter: number;
    rawCells: string[];
  }>;
}

export interface BankStatementImportBatchResult {
  ok: boolean;
  commandName: string;
  projectId: string;
  batchId: string;
  stagedLineCount: number;
  duplicateLineCount: number;
  lines: Array<{
    id: string | null;
    lineIndex: number;
    sourceLineKey: string;
    status: string;
    signedAmount: number;
    duplicate: boolean;
  }>;
  auditId: string;
}

export interface BankStatementImportLineResult {
  id: string;
  batchId: string;
  uploadName: string;
  batchStatus: string;
  batchCreatedBy: string;
  batchCreatedAt: string;
  columns: string[];
  lineIndex: number;
  sourceLineKey: string;
  transactionDate: string;
  counterparty: string;
  memo: string;
  signedAmount: number;
  balanceAfter: number;
  rawCells: string[];
  status: string;
  appliedSheetKey?: string | null;
  appliedRowId?: string | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
}

export interface BankStatementImportLinesResult {
  ok: boolean;
  projectId: string;
  status: string;
  lines: BankStatementImportLineResult[];
}

export interface ApplyBankStatementItemsPayload {
  idempotencyKey: string;
  sheetKey: string;
  expectedSheetVersion?: number | null;
  sheetName?: string;
  items: Array<{
    importLineId: string;
    cells: Array<{
      columnIndex: number;
      rawValue: string;
      userEdited?: boolean;
    }>;
  }>;
}

export interface ApplyBankStatementItemsResult {
  ok: boolean;
  commandName: string;
  projectId: string;
  sheetId: string;
  sheetKey: string;
  sheetVersion: number;
  appliedLineCount: number;
  touchedRows: number[];
  cellIssues?: unknown[];
  actualDelta?: unknown[];
  auditId: string;
}

export interface WeeklyExpenseSheetResult {
  ok: boolean;
  projectId: string;
  sheetId: string;
  sheetKey: string;
  sheetName: string;
  sheetVersion: number;
  rows: Array<{
    id: string;
    rowIndex: number;
    rowVersion: number;
    sourceTxId?: string | null;
    entryKind?: string | null;
    cells: Array<{
      columnIndex: number;
      rawValue: string;
      normalizedValue: string;
      valueType: string;
      validationStatus: string;
      validationMessage?: string | null;
      userEdited: boolean;
    }>;
  }>;
  recentAuditEvents?: unknown[];
}

export interface WeeklyExpenseDraftPayload {
  expectedSheetVersion?: number | null;
  sheetName?: string;
  rows: Array<{
    rowIndex: number;
    tempId?: string;
    sourceTxId?: string;
    entryKind?: string;
    cells: Array<{
      columnIndex: number;
      rawValue: string;
      userEdited?: boolean;
    }>;
  }>;
}

export interface WeeklyExpenseDraftResult {
  ok: boolean;
  commandName: string;
  projectId: string;
  sheetId: string;
  sheetKey: string;
  sheetVersion: number;
  savedRowCount: number;
  savedCellCount: number;
  touchedRows: number[];
  cellIssues: unknown[];
  actualDelta: Array<{
    yearMonth: string;
    weekNo: number;
    cashflowLine: string;
    amount: number;
  }>;
  auditId: string;
}

export interface CashflowVarianceIntent {
  sheetId: string;
  expectedRevision: number;
  action: 'FLAG' | 'REPLY' | 'RESOLVE';
  content?: string;
}

export interface CashflowVarianceMetadataResult {
  week: {
    id: string;
    projectId: string;
    varianceFlag: import('../data/types').VarianceFlag;
    varianceHistory: import('../data/types').VarianceFlagEvent[];
    varianceRevision: number;
    updatedAt: string;
  };
}

export interface WeeklySubmissionStatusIntent {
  yearMonth: string;
  weekNo: number;
  expectedRevision: number;
  changes: {
    projectionEdited?: boolean;
    projectionUpdated?: boolean;
    expenseEdited?: boolean;
    expenseUpdated?: boolean;
    expenseSyncState?: 'pending' | 'review_required' | 'synced' | 'sync_failed';
    expenseReviewPendingCount?: number;
  };
}

export interface WeeklySubmissionStatusMetadataResult {
  status: import('../data/types').WeeklySubmissionStatus;
}

export interface EvidenceRequiredMapIntent {
  expectedRevision: number;
  map: Record<string, string>;
}

export interface EvidenceRequiredMapMetadataResult {
  evidenceRequiredMap: {
    tenantId: string;
    projectId: string;
    map: Record<string, string>;
    evidenceMapRevision: number;
    updatedAt: string;
    updatedBy: string;
  };
}

export interface PlatformApiClientLike {
  get<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
  post<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
  patch<T>(path: string, options: {
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
  request<T>(path: string, options: {
    method?: string;
    tenantId: string;
    actor: RequestActor;
    body?: unknown;
    headers?: HeadersInit;
    idempotencyKey?: string;
    requestId?: string;
    retries?: number;
    timeoutMs?: number;
  }): Promise<{ data: T }>;
}

const DEFAULT_BFF_BASE_URL = 'http://127.0.0.1:8787';

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_BFF_BASE_URL;
  return value.trim().replace(/\/$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveBrowserBffBaseUrl(configured: string): string {
  if (typeof window === 'undefined' || !window.location?.origin) return configured;
  const runtimeHost = window.location.hostname;
  if (isLoopbackHostname(runtimeHost)) return configured;
  try {
    const configuredUrl = new URL(configured);
    if (
      isLoopbackHostname(configuredUrl.hostname)
      || configuredUrl.hostname.includes('innerplatform-jvm-weekly-api')
    ) {
      return window.location.origin;
    }
  } catch {
    return configured;
  }
  return configured;
}

export function readPlatformApiRuntimeConfig(
  env: Record<string, unknown> = import.meta.env,
): PlatformApiRuntimeConfig {
  const baseUrl = normalizeBaseUrl(env.VITE_PLATFORM_API_BASE_URL);
  return {
    enabled: parseFeatureFlag(env.VITE_PLATFORM_API_ENABLED, false),
    baseUrl: resolveBrowserBffBaseUrl(baseUrl),
  };
}

export function toRequestActor(actor: ActorLike): RequestActor {
  const mapped: RequestActor = {
    id: actor.uid,
    email: actor.email,
    role: actor.role,
  };
  if (actor.idToken) {
    mapped.idToken = actor.idToken;
  }
  return mapped;
}

export function createPlatformApiClient(
  env: Record<string, unknown> = import.meta.env,
): PlatformApiClient {
  const config = readPlatformApiRuntimeConfig(env);
  return new PlatformApiClient({
    baseUrl: config.baseUrl,
    maxRetries: 2,
    retryDelayMs: 200,
    timeoutMs: 4000,
  });
}

export async function fetchProjectsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  client?: PlatformApiClientLike;
}): Promise<Project[]> {
  const apiClient = resolveClient(params.client);
  const projects: Project[] = [];
  const seenCursors = new Set<string>();
  let cursor = '';

  for (;;) {
    const response = await apiClient.get<{ items: Project[]; nextCursor: string | null }>(
      `/api/v1/projects?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      {
        tenantId: params.tenantId,
        actor: toRequestActor(params.actor),
        timeoutMs: 10000,
      },
    );
    if (Array.isArray(response.data?.items)) {
      projects.push(...response.data.items);
    }
    const nextCursor = typeof response.data?.nextCursor === 'string' ? response.data.nextCursor : '';
    if (!nextCursor || seenCursors.has(nextCursor)) return projects;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
}

export async function fetchAssignedProjectRequestsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  client?: PlatformApiClientLike;
}): Promise<{ requests: ProjectRequest[]; projects: Project[] }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.get<{ items: ProjectRequest[]; projects: Project[] }>(
    '/api/v1/project-requests/assigned-to-me',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 10000,
    },
  );
  return {
    requests: Array.isArray(response.data?.items) ? response.data.items : [],
    projects: Array.isArray(response.data?.projects) ? response.data.projects : [],
  };
}

const PROJECT_REQUEST_PROJECT_ID_BATCH_SIZE = 200;

async function fetchProjectRequestsByProjectIds(params: {
  apiClient: PlatformApiClientLike;
  path: string;
  tenantId: string;
  actor: ActorLike;
  projectIds: string[];
}): Promise<ProjectRequest[]> {
  const projectIds = Array.from(new Set(params.projectIds.map((id) => id.trim()).filter(Boolean)));
  const batches: string[][] = [];
  for (let index = 0; index < projectIds.length; index += PROJECT_REQUEST_PROJECT_ID_BATCH_SIZE) {
    batches.push(projectIds.slice(index, index + PROJECT_REQUEST_PROJECT_ID_BATCH_SIZE));
  }
  const responses = await Promise.all(batches.map((batch) => params.apiClient.post<{ items: ProjectRequest[] }>(
    params.path,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: { projectIds: batch },
      timeoutMs: 10000,
    },
  )));
  const requestsById = new Map<string, ProjectRequest>();
  responses.forEach((response) => {
    if (!Array.isArray(response.data?.items)) return;
    response.data.items.forEach((request) => requestsById.set(request.id, request));
  });
  return Array.from(requestsById.values()).sort((left, right) => (
    String(right.requestedAt || '').localeCompare(String(left.requestedAt || ''))
    || String(left.id).localeCompare(String(right.id))
  ));
}

export async function fetchPendingProjectChangeRequestsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectIds: string[];
  client?: PlatformApiClientLike;
}): Promise<ProjectRequest[]> {
  const apiClient = resolveClient(params.client);
  return fetchProjectRequestsByProjectIds({
    apiClient,
    path: '/api/v1/project-requests/pending-changes',
    tenantId: params.tenantId,
    actor: params.actor,
    projectIds: params.projectIds,
  });
}

export async function fetchProjectReviewInboxViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectIds: string[];
  client?: PlatformApiClientLike;
}): Promise<ProjectRequest[]> {
  const apiClient = resolveClient(params.client);
  return fetchProjectRequestsByProjectIds({
    apiClient,
    path: '/api/v1/project-requests/review-inbox',
    tenantId: params.tenantId,
    actor: params.actor,
    projectIds: params.projectIds,
  });
}

export async function fetchLatestProjectRequestViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectRequest | null> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.get<{ item: ProjectRequest | null }>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/latest-request`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 10000,
    },
  );
  return response.data?.item || null;
}

let defaultPlatformApiClient: PlatformApiClientLike | undefined;

function resolveClient(client?: PlatformApiClientLike): PlatformApiClientLike {
  return client || (defaultPlatformApiClient ||= createPlatformApiClient());
}

function encodeHeaderValue(value: string): string {
  return encodeURIComponent(value);
}

export async function upsertProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  project: UpsertProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>('/api/v1/projects', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.project,
  });

  return response.data;
}

export async function trashProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: TrashProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string; trashedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string; trashedAt: string }>(
    `/api/v1/projects/${params.projectId}/trash`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
    },
  );

  return response.data;
}

export async function restoreProjectViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: RestoreProjectPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>(
    `/api/v1/projects/${params.projectId}/restore`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
    },
  );

  return response.data;
}

export async function upsertLedgerViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  ledger: UpsertLedgerPayload;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string }>('/api/v1/ledgers', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.ledger,
  });
  return response.data;
}

export async function upsertTransactionViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transaction: UpsertTransactionPayload;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; tenantId: string; version: number; updatedAt: string; state: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; tenantId: string; version: number; updatedAt: string; state: string }>('/api/v1/transactions', {
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    body: params.transaction,
    ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
  });
  return response.data;
}

export async function changeTransactionStateViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  newState: TransactionState;
  expectedVersion: number;
  reason?: string;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; state: string; rejectedReason: string | null; version: number; updatedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<{ id: string; state: string; rejectedReason: string | null; version: number; updatedAt: string }>(
    `/api/v1/transactions/${params.transactionId}/state`,
    {
      method: 'PATCH',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        newState: params.newState,
        expectedVersion: params.expectedVersion,
        reason: params.reason,
      },
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );

  return response.data;
}

export async function addCommentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  comment: CreateCommentPayload;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; transactionId: string; version: number; createdAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; transactionId: string; version: number; createdAt: string }>(
    `/api/v1/transactions/${params.transactionId}/comments`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.comment,
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );
  return response.data;
}

export async function addEvidenceViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  evidence: CreateEvidencePayload;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<{ id: string; transactionId: string; version: number; uploadedAt: string }> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{ id: string; transactionId: string; version: number; uploadedAt: string }>(
    `/api/v1/transactions/${params.transactionId}/evidences`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.evidence,
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );
  return response.data;
}

export async function fetchAuthGovernanceUsersViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  client?: PlatformApiClientLike;
}): Promise<AuthGovernanceDirectoryResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.get<AuthGovernanceDirectoryResult>(
    '/api/v1/admin/auth-governance/users',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 10000,
    },
  );
  return response.data;
}

export async function deepSyncAuthGovernanceUserViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  identityKey: string;
  role: string;
  reason?: string;
  client?: PlatformApiClientLike;
}): Promise<AuthGovernanceDeepSyncResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<AuthGovernanceDeepSyncResult>(
    `/api/v1/admin/auth-governance/users/${encodeURIComponent(params.identityKey)}/deep-sync`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        role: params.role,
        ...(params.reason ? { reason: params.reason } : {}),
      },
      timeoutMs: 10000,
    },
  );
  return response.data;
}

export async function provisionProjectEvidenceDriveRootViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<ProvisionProjectEvidenceDriveRootResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProvisionProjectEvidenceDriveRootResult>(
    `/api/v1/projects/${params.projectId}/evidence-drive/root/provision`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
    },
  );
  return response.data;
}

export async function previewGoogleSheetImportViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  sheetName?: string;
  client?: PlatformApiClientLike;
}): Promise<GoogleSheetImportPreviewResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<GoogleSheetImportPreviewResult>(
    `/api/v1/projects/${params.projectId}/google-sheet-import/preview`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      headers: params.actor.googleAccessToken
        ? { 'x-google-access-token': params.actor.googleAccessToken }
        : undefined,
      body: {
        value: params.value,
        ...(params.sheetName ? { sheetName: params.sheetName } : {}),
      },
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function analyzeGoogleSheetImportViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  spreadsheetTitle?: string;
  selectedSheetName: string;
  matrix: string[][];
  client?: PlatformApiClientLike;
}): Promise<GoogleSheetMigrationAnalysisResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<GoogleSheetMigrationAnalysisResult>(
    `/api/v1/projects/${params.projectId}/google-sheet-import/analyze`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        ...(params.spreadsheetTitle ? { spreadsheetTitle: params.spreadsheetTitle } : {}),
        selectedSheetName: params.selectedSheetName,
        matrix: params.matrix,
      },
      timeoutMs: 25000,
    },
  );
  return normalizeGoogleSheetMigrationAnalysisResult(response.data);
}

export async function uploadProjectSheetSourceViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  upload: ProjectSheetSourceUploadPayload;
  client?: PlatformApiClientLike;
}): Promise<ProjectSheetSourceSnapshot> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectSheetSourceSnapshot>(
    `/api/v1/projects/${params.projectId}/sheet-sources/upload`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      timeoutMs: 45000,
    },
  );
  return response.data;
}

export async function analyzeProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  fileName: string;
  documentText?: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectRequestContractAnalysisResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectRequestContractAnalysisResult>(
    '/api/v1/project-requests/contract/analyze',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        fileName: params.fileName,
        ...(params.documentText ? { documentText: params.documentText } : {}),
      },
      timeoutMs: 45000,
    },
  );
  return normalizeProjectRequestContractAnalysisResult(response.data);
}

export async function uploadProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  upload: ProjectRequestContractUploadPayload;
  client?: PlatformApiClientLike;
}) {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<{
    path: string;
    name: string;
    downloadURL: string;
    size: number;
    contentType: string;
    uploadedAt: string;
  }>(
    '/api/v1/project-requests/contract/upload',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      timeoutMs: 45000,
    },
  );
  return response.data;
}

export async function processProjectRequestContractViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  file: File;
  client?: PlatformApiClientLike;
}): Promise<{
  contractDocument: {
    path: string;
    name: string;
    downloadURL: string;
    size: number;
    contentType: string;
    uploadedAt: string;
  };
  analysis: ProjectRequestContractAnalysisResult;
}> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<{
    contractDocument: {
      path: string;
      name: string;
      downloadURL: string;
      size: number;
      contentType: string;
      uploadedAt: string;
    };
    analysis: ProjectRequestContractAnalysisResult;
  }>(
    '/api/v1/project-requests/contract/process',
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeHeaderValue(params.file.name),
        'x-file-type': params.file.type || 'application/pdf',
        'x-file-size': String(params.file.size || 0),
      },
      body: params.file,
      timeoutMs: 45000,
      retries: 0,
    },
  );
  return {
    contractDocument: response.data.contractDocument,
    analysis: normalizeProjectRequestContractAnalysisResult(response.data.analysis),
  };
}

export async function notifyProjectRequestRegistrationViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectRequestId: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectRequestRegistrationNotificationResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectRequestRegistrationNotificationResult>(
    `/api/v1/project-requests/${encodeURIComponent(params.projectRequestId)}/notify-registration`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {},
      idempotencyKey: `project-request-registration-notify:${params.projectRequestId}`,
      timeoutMs: 10000,
      retries: 0,
    },
  );
  return response.data;
}

export async function reviewProjectExecutiveStatusViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  review: ProjectExecutiveReviewPayload;
  client?: PlatformApiClientLike;
}): Promise<ProjectExecutiveReviewResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectExecutiveReviewResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/executive-review`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: normalizeProjectExecutiveReviewPayload(params.review),
      timeoutMs: 10000,
      retries: 0,
    },
  );
  return response.data;
}

export async function resubmitProjectExecutiveReviewViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: ProjectExecutiveReviewResubmitPayload;
  client?: PlatformApiClientLike;
}): Promise<ProjectExecutiveReviewResubmitResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectExecutiveReviewResubmitResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/executive-review/resubmit`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: normalizeProjectExecutiveReviewResubmitPayload(params.payload),
      timeoutMs: 10000,
      retries: 0,
    },
  );
  return response.data;
}

export async function reviewProjectManagementPlanningStatusViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  review: ProjectManagementPlanningReviewPayload;
  client?: PlatformApiClientLike;
}): Promise<ProjectManagementPlanningReviewResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ProjectManagementPlanningReviewResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/management-planning-review`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: normalizeProjectManagementPlanningReviewPayload(params.review),
      timeoutMs: 10000,
      retries: 0,
    },
  );
  return response.data;
}

export async function linkProjectEvidenceDriveRootViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  value: string;
  client?: PlatformApiClientLike;
}): Promise<LinkProjectEvidenceDriveRootResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<LinkProjectEvidenceDriveRootResult>(
    `/api/v1/projects/${params.projectId}/evidence-drive/root/link`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: { value: params.value },
    },
  );
  return response.data;
}

export async function provisionTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<ProvisionTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<ProvisionTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/provision`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 15000,
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );
  return response.data;
}

export async function syncTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<SyncTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<SyncTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/sync`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 20000,
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );
  return response.data;
}

export async function uploadTransactionEvidenceDriveViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  upload: UploadTransactionEvidenceDrivePayload;
  lease?: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<UploadTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<UploadTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/upload`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      retries: 0,
      timeoutMs: 30000,
      ...(params.lease ? { headers: cashflowMutationHeaders(params.lease) } : {}),
    },
  );
  return response.data;
}

export async function processBusinessCardViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  upload: BusinessCardProcessPayload;
  client?: PlatformApiClientLike;
}): Promise<BusinessCardImportResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<BusinessCardImportResult>(
    '/api/v1/business-card-imports/process',
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.upload,
      retries: 0,
      timeoutMs: 60000,
    },
  );
  return {
    ...response.data,
    extracted: normalizeBusinessCardExtraction(response.data.extracted),
  };
}

export async function listBusinessCardImportsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  status?: 'needs_review' | 'saved' | 'failed';
  client?: PlatformApiClientLike;
}): Promise<{ items: BusinessCardImportListItem[]; count: number; nextCursor: string | null }> {
  const apiClient = resolveClient(params.client);
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  const response = await apiClient.get<{ items: BusinessCardImportListItem[]; count: number; nextCursor: string | null }>(
    `/api/v1/business-card-imports${searchParams.size ? `?${searchParams.toString()}` : ''}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 10000,
    },
  );
  return {
    ...response.data,
    items: (response.data.items || []).map((item) => ({
      ...item,
      extracted: item.extracted ? normalizeBusinessCardExtraction(item.extracted) : null,
    })),
  };
}

export async function confirmBusinessCardImportViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  importId: string;
  contact: BusinessCardConfirmPayload;
  client?: PlatformApiClientLike;
}): Promise<BusinessCardConfirmResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<BusinessCardConfirmResult>(
    `/api/v1/business-card-imports/${encodeURIComponent(params.importId)}/confirm`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.contact,
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function searchContactsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  query: string;
  client?: PlatformApiClientLike;
}): Promise<{ items: ContactSearchResult[]; count: number; nextCursor: string | null }> {
  const apiClient = resolveClient(params.client);
  const searchParams = new URLSearchParams();
  searchParams.set('query', params.query);
  const response = await apiClient.get<{ items: ContactSearchResult[]; count: number; nextCursor: string | null }>(
    `/api/v1/contacts?${searchParams.toString()}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      timeoutMs: 10000,
    },
  );
  return response.data;
}

export async function updateContactViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  contactId: string;
  contact: BusinessCardConfirmPayload;
  client?: PlatformApiClientLike;
}): Promise<ContactUpdateResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.patch<ContactUpdateResult>(
    `/api/v1/contacts/${encodeURIComponent(params.contactId)}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.contact,
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function overrideTransactionEvidenceDriveCategoriesViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  transactionId: string;
  overrides: OverrideTransactionEvidenceDriveCategoriesPayload;
  client?: PlatformApiClientLike;
}): Promise<SyncTransactionEvidenceDriveResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.request<SyncTransactionEvidenceDriveResult>(
    `/api/v1/transactions/${params.transactionId}/evidence-drive/overrides`,
    {
      method: 'POST',
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.overrides,
      retries: 0,
      timeoutMs: 15000,
    },
  );
  return response.data;
}

export async function upsertCashflowWeekAmountsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: CashflowWeekAmountsPayload;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<CashflowWeekAmountsResult> {
  if (params.payload.mode !== 'projection') {
    throw new Error('Canonical actual cashflow must be saved through a weekly expense sheet');
  }
  return saveCashflowProjectionBatchViaBff({
    tenantId: params.tenantId,
    actor: params.actor,
    projectId: params.projectId,
    idempotencyKey: params.idempotencyKey,
    lease: params.lease,
    finalize: params.finalize,
    client: params.client,
    lines: Object.entries(params.payload.amounts).map(([cashflowLine, amount]) => ({
      yearMonth: params.payload.yearMonth,
      weekNo: params.payload.weekNo,
      cashflowLine,
      amount,
    })),
  });
}

export async function applyCashflowVarianceIntentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  intent: CashflowVarianceIntent;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<CashflowVarianceMetadataResult> {
  const response = await resolveClient(params.client).post<CashflowVarianceMetadataResult>(
    `/api/v1/cashflow-metadata/${encodeURIComponent(params.projectId)}/variance`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.intent,
      headers: cashflowMutationHeaders(params.lease),
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12_000,
    },
  );
  return response.data;
}

export async function applyWeeklySubmissionStatusIntentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  intent: WeeklySubmissionStatusIntent;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<WeeklySubmissionStatusMetadataResult> {
  const response = await resolveClient(params.client).post<WeeklySubmissionStatusMetadataResult>(
    `/api/v1/cashflow-metadata/${encodeURIComponent(params.projectId)}/weekly-submission-status`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.intent,
      headers: cashflowMutationHeaders(params.lease),
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12_000,
    },
  );
  return response.data;
}

export async function applyEvidenceRequiredMapIntentViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  intent: EvidenceRequiredMapIntent;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  client?: PlatformApiClientLike;
}): Promise<EvidenceRequiredMapMetadataResult> {
  const response = await resolveClient(params.client).post<EvidenceRequiredMapMetadataResult>(
    `/api/v1/cashflow-metadata/${encodeURIComponent(params.projectId)}/evidence-required-map`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.intent,
      headers: cashflowMutationHeaders(params.lease),
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12_000,
    },
  );
  return response.data;
}

export async function saveCashflowProjectionBatchViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  lines: Array<{ yearMonth: string; weekNo: number; cashflowLine: string; amount: number }>;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<CashflowWeekAmountsResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<CashflowWeekAmountsResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/projection`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: { lines: params.lines },
      headers: {
        ...cashflowMutationHeaders(params.lease),
        ...(params.finalize ? { 'x-edit-finalize': 'true' } : {}),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function fetchCashflowSnapshotViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  asOf?: string;
  rangeStart?: CashflowRangeBoundary;
  rangeEnd?: CashflowRangeBoundary;
  client?: PlatformApiClientLike;
}): Promise<CashflowSnapshotResult> {
  const apiClient = resolveClient(params.client);
  const query = new URLSearchParams();
  if (params.asOf) query.set('asOf', params.asOf);
  if (params.rangeStart) query.set('rangeStart', `${params.rangeStart.yearMonth}:${params.rangeStart.weekNo}`);
  if (params.rangeEnd) query.set('rangeEnd', `${params.rangeEnd.yearMonth}:${params.rangeEnd.weekNo}`);
  const serializedQuery = query.toString();
  const queryString = serializedQuery ? `?${serializedQuery}` : '';
  const response = await apiClient.get<CashflowSnapshotResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}${queryString}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

const cashflowMonthCloseRequests = new WeakMap<
  PlatformApiClientLike,
  Map<string, Promise<CashflowMonthCloseResult>>
>();

export async function fetchCashflowMonthCloseViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  yearMonth: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseResult> {
  const client = resolveClient(params.client);
  let clientRequests = cashflowMonthCloseRequests.get(client);
  if (!clientRequests) {
    clientRequests = new Map();
    cashflowMonthCloseRequests.set(client, clientRequests);
  }
  const requestKey = [params.tenantId, params.actor.uid, params.projectId, params.yearMonth].join(':');
  const existing = clientRequests.get(requestKey);
  if (existing) return existing;

  const request = (async () => {
    const response = await client.get<CashflowMonthCloseResult>(
      `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close?yearMonth=${encodeURIComponent(params.yearMonth)}`,
      {
        tenantId: params.tenantId,
        actor: toRequestActor(params.actor),
        retries: 0,
        timeoutMs: 27_000,
      },
    );
    return response.data;
  })();
  clientRequests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (clientRequests.get(requestKey) === request) clientRequests.delete(requestKey);
  }
}

export async function fetchCashflowMonthCloseQaDateTimeViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseQaDateTimeSetting> {
  const response = await resolveClient(params.client).get<CashflowMonthCloseQaDateTimeSetting>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close/qa-date`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function setCashflowMonthCloseQaDateTimeViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  qaDateTime: string | null;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseQaDateTimeSetting> {
  const response = await resolveClient(params.client).post<CashflowMonthCloseQaDateTimeSetting>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close/qa-date`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: { qaDateTime: params.qaDateTime },
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function completeCashflowWeeklyUpdateViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  yearMonth?: string;
  weekNo?: number;
  client?: PlatformApiClientLike;
}): Promise<CashflowWeeklyUpdateCompletionResult> {
  const hasExplicitScope = params.yearMonth !== undefined || params.weekNo !== undefined;
  const response = await resolveClient(params.client).post<CashflowWeeklyUpdateCompletionResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/weekly-update-complete`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: hasExplicitScope
        ? { yearMonth: params.yearMonth, weekNo: params.weekNo }
        : {},
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function fetchCashflowWeeklyUpdateViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  yearMonth: string;
  weekNo: number;
  client?: PlatformApiClientLike;
}): Promise<CashflowWeeklyUpdateCompletionResult> {
  const query = new URLSearchParams({
    yearMonth: params.yearMonth,
    weekNo: String(params.weekNo),
  });
  const response = await resolveClient(params.client).get<CashflowWeeklyUpdateCompletionResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/weekly-update-complete?${query.toString()}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function reopenCashflowWeeklyUpdateViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  yearMonth: string;
  weekNo: number;
  expectedRevision: number;
  reason: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowWeeklyUpdateCompletionResult> {
  const response = await resolveClient(params.client).post<CashflowWeeklyUpdateCompletionResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/weekly-update-complete/reopen`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: {
        yearMonth: params.yearMonth,
        weekNo: params.weekNo,
        expectedRevision: params.expectedRevision,
        reason: params.reason,
      },
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function fetchCashflowActivityViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<{ projectId: string; events: CashflowActivityEvent[] }> {
  const response = await resolveClient(params.client).get<{ projectId: string; events: CashflowActivityEvent[] }>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/activity`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function closeCashflowMonthViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: CloseCashflowMonthPayload;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseResult> {
  const response = await resolveClient(params.client).post<CashflowMonthCloseResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 27_000,
    },
  );
  return response.data;
}

export async function requestCashflowMonthReopenViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: RequestCashflowMonthReopenPayload;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseResult> {
  const response = await resolveClient(params.client).post<CashflowMonthCloseResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close/reopen-request`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function decideCashflowMonthReopenViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: DecideCashflowMonthReopenPayload;
  idempotencyKey: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowMonthCloseResult> {
  const response = await resolveClient(params.client).post<CashflowMonthCloseResult>(
    `/api/v1/cashflow/${encodeURIComponent(params.projectId)}/month-close/reopen-decision`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function syncProjectCashflowActualsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<ProjectCashflowActualSyncResult> {
  const snapshot = await fetchCashflowSnapshotViaBff(params);
  const weeks = snapshot.readModel.months.flatMap((month) => month.actual.weeks.map((week) => ({
    yearMonth: month.yearMonth,
    weekNo: week.weekNo,
    amounts: week.amounts,
  })));
  return {
    ok: true,
    projectId: snapshot.projectId,
    sourceRows: snapshot.actual.length,
    sheetCount: new Set(snapshot.actual.map((line) => line.sheetKey)).size,
    upsertedWeeks: weeks.length,
    clearedWeeks: 0,
    weeks,
    cleared: [],
    updatedAt: new Date().toISOString(),
  };
}

export async function readWeeklyExpenseSheetViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  sheetKey?: string;
  client?: PlatformApiClientLike;
}): Promise<WeeklyExpenseSheetResult> {
  const apiClient = resolveClient(params.client);
  const sheetKey = params.sheetKey || 'default';
  const response = await apiClient.get<WeeklyExpenseSheetResult>(
    `/api/v1/weekly-expenses/${encodeURIComponent(params.projectId)}/sheets/${encodeURIComponent(sheetKey)}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function saveWeeklyExpenseDraftViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  sheetKey?: string;
  payload: WeeklyExpenseDraftPayload;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<WeeklyExpenseDraftResult> {
  const apiClient = resolveClient(params.client);
  const sheetKey = params.sheetKey || 'default';
  const response = await apiClient.post<WeeklyExpenseDraftResult>(
    `/api/v1/weekly-expenses/${encodeURIComponent(params.projectId)}/sheets/${encodeURIComponent(sheetKey)}/save-draft`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      headers: {
        ...cashflowMutationHeaders(params.lease),
        ...(params.finalize ? { 'x-edit-finalize': 'true' } : {}),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function fetchCashflowLaborRiskViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  client?: PlatformApiClientLike;
}): Promise<CashflowLaborRiskResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.get<CashflowLaborRiskResult>(
    `/api/v1/projects/${encodeURIComponent(params.projectId)}/cashflow-labor-risk`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export async function importBankStatementBatchViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: BankStatementImportBatchPayload;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<BankStatementImportBatchResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<BankStatementImportBatchResult>(
    `/api/v1/weekly-expenses/${encodeURIComponent(params.projectId)}/bank-statements/import-batch`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      headers: {
        ...cashflowMutationHeaders(params.lease),
        ...(params.finalize ? { 'x-edit-finalize': 'true' } : {}),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function applyBankStatementItemsViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  payload: ApplyBankStatementItemsPayload;
  idempotencyKey: string;
  lease: CashflowMutationLease;
  finalize?: boolean;
  client?: PlatformApiClientLike;
}): Promise<ApplyBankStatementItemsResult> {
  const apiClient = resolveClient(params.client);
  const response = await apiClient.post<ApplyBankStatementItemsResult>(
    `/api/v1/weekly-expenses/${encodeURIComponent(params.projectId)}/bank-statements/apply-items`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      body: params.payload,
      headers: {
        ...cashflowMutationHeaders(params.lease),
        ...(params.finalize ? { 'x-edit-finalize': 'true' } : {}),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 20000,
    },
  );
  return response.data;
}

export async function listBankStatementImportLinesViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  status?: 'staged' | 'applied' | 'all';
  client?: PlatformApiClientLike;
}): Promise<BankStatementImportLinesResult> {
  const apiClient = resolveClient(params.client);
  const suffix = params.status ? `?status=${encodeURIComponent(params.status)}` : '';
  const response = await apiClient.get<BankStatementImportLinesResult>(
    `/api/v1/weekly-expenses/${encodeURIComponent(params.projectId)}/bank-statements/import-lines${suffix}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 12000,
    },
  );
  return response.data;
}

export function isPlatformApiEnabled(): boolean {
  return featureFlags.platformApiEnabled;
}

function resolveBinaryErrorMessage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '파일 다운로드 요청에 실패했습니다.';
  try {
    const parsed = JSON.parse(trimmed) as { message?: string; error?: string };
    return parsed.message || parsed.error || trimmed;
  } catch {
    return trimmed;
  }
}

function parseContentDispositionFileName(headerValue: string | null): string {
  const value = String(headerValue || '').trim();
  if (!value) return '';
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const basicMatch = value.match(/filename="([^"]+)"/i) || value.match(/filename=([^;]+)/i);
  return basicMatch?.[1]?.trim() || '';
}

export async function exportCashflowWorkbookViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  body: {
    scope: 'all' | 'single';
    projectId?: string;
    accountType?: AccountType;
    startYearMonth: string;
    endYearMonth: string;
    variant: 'single-project' | 'combined' | 'multi-sheet';
  };
}): Promise<{ blob: Blob; fileName: string }> {
  const config = readPlatformApiRuntimeConfig();
  const headers = buildStandardHeaders({
    tenantId: params.tenantId,
    actor: toRequestActor(params.actor),
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
  });
  const response = await fetch(`${config.baseUrl}/api/v1/cashflow-exports`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params.body),
  });

  if (!response.ok) {
    throw new Error(resolveBinaryErrorMessage(await response.text()));
  }

  return {
    blob: await response.blob(),
    fileName: parseContentDispositionFileName(response.headers.get('content-disposition')) || 'cashflow-export.xlsx',
  };
}

// ─── Budget Suggestion ───────────────────────────────────────────────────────

export interface BudgetSuggestion {
  budgetCategory: string;
  budgetSubCategory: string;
  /** 'history' = 과거 거래 패턴 기반, 'codebook' = 코드북 키워드 매칭 */
  confidence: 'history' | 'codebook';
}

/**
 * 거래처 이름 기반 비목/세목 제안을 BFF에서 조회한다.
 * 히스토리가 없으면 null 반환.
 */
export async function fetchBudgetSuggestionViaBff(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  counterparty: string;
  client?: PlatformApiClientLike;
}): Promise<BudgetSuggestion | null> {
  if (!params.counterparty.trim() || !params.projectId.trim()) return null;
  const apiClient = resolveClient(params.client);
  const qs = new URLSearchParams({
    counterparty: params.counterparty.trim(),
    projectId: params.projectId.trim(),
  });
  const response = await apiClient.get<{ suggestion: BudgetSuggestion | null }>(
    `/api/v1/budget/suggest?${qs}`,
    {
      tenantId: params.tenantId,
      actor: toRequestActor(params.actor),
      retries: 0,
      timeoutMs: 3000,
    },
  );
  return response.data.suggestion ?? null;
}
