import type { RequestActor } from '../platform/request-context';
import {
  createPlatformApiClient,
  toRequestActor,
  type ActorLike,
  type PlatformApiClientLike,
} from './platform-bff-client';

export type CashflowPeriodPolicyTone = 'positive' | 'caution' | 'critical';

export interface CashflowPeriodPolicyIssue {
  code: string;
  severity: string;
  severityTone: CashflowPeriodPolicyTone;
  label: string;
  detail: string;
}

export interface CashflowPeriodPolicySuperadmin {
  uid: string;
  personId: string | null;
  displayName: string;
  identityStatus: string;
  identityStatusLabel: string;
  identityTone: CashflowPeriodPolicyTone;
}

export interface CashflowPeriodPolicyExecutiveApproverCandidate {
  uid: string;
  personId: string;
  displayName: string;
}

export interface CashflowPeriodPolicyStatusBlock {
  status: string;
  statusLabel: string;
  tone: CashflowPeriodPolicyTone;
}

export interface CashflowPeriodPolicyAuthority extends CashflowPeriodPolicyStatusBlock {
  closedThrough: string | null;
  closedThroughLabel: string;
  settlementMonth: string | null;
  settlementMonthLabel: string;
  revision: number | null;
  revisionLabel: string;
  rootHash: string | null;
  rootHashLabel: string;
  closedAt: string | null;
  closedAtLabel: string;
}

export interface CashflowCumulativeCloseHeadRecoveryExpectedEvidence {
  contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1';
  authorityFingerprint: string;
  monthlyCloseId: string;
  monthlyCloseVersionId: string;
  requestId: string;
  monthlyCloseRevision: number;
  requestRevision: number;
  sourceRevision: string;
  snapshotHash: string;
  rootHash: string;
  headRevision: number;
}

export interface CashflowCumulativeCloseResetToRecloseExpectedEvidence {
  contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1';
  authorityFingerprint: string;
  monthlyCloseFingerprint: string;
  immutableEvidenceFingerprint: string;
  monthlyCloseId: string;
  yearMonth: string;
}

export interface CashflowPeriodPolicyResetToReclose extends CashflowPeriodPolicyStatusBlock {
  actionAllowed: boolean;
  selectionAllowed: boolean;
  expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence | null;
  warning: string | null;
  guide: string;
  cycleCandidates: Array<{
    yearMonth: string;
    yearMonthLabel: string;
    expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence;
  }>;
}

export interface CashflowPeriodPolicyRecovery extends CashflowPeriodPolicyStatusBlock {
  actionAllowed: boolean;
  expectedEvidence: CashflowCumulativeCloseHeadRecoveryExpectedEvidence | null;
  reasons: string[];
  warning: string | null;
  guide: string;
  nextAction: {
    type: string;
    label: string;
    href: string;
  } | null;
  resetToReclose: CashflowPeriodPolicyResetToReclose;
}

export interface CashflowPeriodPolicyLatestRun extends CashflowPeriodPolicyStatusBlock {
  yearMonth: string | null;
  yearMonthLabel: string;
  revision: number | null;
  revisionLabel: string;
  closedAt: string | null;
  closedAtLabel: string;
  closedByUid: string | null;
  closedByLabel: string;
}

export interface CashflowPeriodPolicySheet extends CashflowPeriodPolicyStatusBlock {
  weeklyYear: number | null;
  weeklyYearLabel: string;
  annualYears: number[];
  annualYearsLabel: string;
  sourceRevision: string | null;
  sourceRevisionLabel: string;
  appliedSourceRevision: string | null;
  appliedSourceRevisionLabel: string;
  targetRevisionAtFetch: string | null;
  targetRevisionAtFetchLabel: string;
  appliedTargetRevision: string | null;
  appliedTargetRevisionLabel: string;
  revisionStatus: string;
  revisionStatusLabel: string;
  revisionTone: CashflowPeriodPolicyTone;
  capturedAt: string | null;
  capturedAtLabel: string;
}

export interface CashflowPeriodPolicyChangeAction {
  enabled: boolean;
  status: string;
  tone: CashflowPeriodPolicyTone;
  guide: string;
}

export interface CashflowPeriodPolicyExecutiveApprover extends CashflowPeriodPolicyStatusBlock {
  uid: string | null;
  personId: string | null;
  displayName: string;
  expectedVersion: number;
  expectedVersionLabel: string;
  changeAction: CashflowPeriodPolicyChangeAction;
}

export interface CashflowPeriodPolicyAmendment {
  id: string | null;
  projectId: string | null;
  projectName: string;
  yearMonth: string | null;
  yearMonthLabel: string;
  reason: string | null;
  reasonLabel: string;
  actorUid: string | null;
  actorName: string | null;
  actorLabel: string;
  closeRevision: number | null;
  closeRevisionLabel: string;
  resultingCloseRevision: number | null;
  resultingCloseRevisionLabel: string;
  closeSnapshotHash: string | null;
  closeSnapshotHashLabel: string;
  sourceRevision: string | null;
  sourceRevisionLabel: string;
  targetRevision: string | null;
  targetRevisionLabel: string;
  resultingTargetRevision: string | null;
  resultingTargetRevisionLabel: string;
  createdAt: string | null;
  createdAtLabel: string;
}

export interface CashflowForecastVarianceMetric {
  key: string;
  label: string;
  baseline: number | null;
  baselineLabel: string;
  actual: number | null;
  actualLabel: string;
  variance: number | null;
  varianceLabel: string;
}

export interface CashflowForecastVarianceRow extends CashflowPeriodPolicyStatusBlock {
  reason: string | null;
  reasonLabel: string | null;
  projectId: string | null;
  yearMonth: string | null;
  weekNo: number | null;
  weekLabel: string;
  baseline: Record<string, unknown> | null;
  actual: Record<string, unknown> | null;
  variance: Record<string, number> | null;
  metrics: CashflowForecastVarianceMetric[];
}

export interface CashflowPeriodPolicyForecastVariance extends CashflowPeriodPolicyStatusBlock {
  eligibleCount: number;
  coverageCount: number;
  coverageLabel: string;
  rows: CashflowForecastVarianceRow[];
}

export interface CashflowPeriodPolicyForecastVarianceSummary extends CashflowPeriodPolicyStatusBlock {
  complete: boolean;
  eligibleCount: number;
  coverageCount: number;
  coverageLabel: string;
  totals: {
    complete: boolean;
    baseline: Record<string, number> | null;
    actual: Record<string, number> | null;
    variance: Record<string, number> | null;
    metrics: CashflowForecastVarianceMetric[];
  };
}

export interface CashflowPeriodPolicyProjectItem {
  project: CashflowPeriodPolicyStatusBlock & { id: string; name: string };
  authority: CashflowPeriodPolicyAuthority;
  recovery: CashflowPeriodPolicyRecovery;
  latestRun: CashflowPeriodPolicyLatestRun;
  sheet: CashflowPeriodPolicySheet;
  executiveApprover: CashflowPeriodPolicyExecutiveApprover;
  forecastVariance: CashflowPeriodPolicyForecastVariance;
  issues: CashflowPeriodPolicyIssue[];
}

export interface CashflowPeriodPolicyResponse extends CashflowPeriodPolicyStatusBlock {
  generatedAt: string | null;
  generatedAtLabel: string;
  issues: CashflowPeriodPolicyIssue[];
  superadmins: CashflowPeriodPolicyStatusBlock & { items: CashflowPeriodPolicySuperadmin[] };
  executiveApproverCandidates: CashflowPeriodPolicyStatusBlock & {
    items: CashflowPeriodPolicyExecutiveApproverCandidate[];
  };
  amendments: CashflowPeriodPolicyStatusBlock & { rows: CashflowPeriodPolicyAmendment[] };
  forecastVariance: CashflowPeriodPolicyForecastVarianceSummary;
  items: CashflowPeriodPolicyProjectItem[];
}

export interface CashflowExecutiveApproverUpdateResponse {
  projectId: string;
  changed: boolean;
  executiveApprover: CashflowPeriodPolicyExecutiveApprover;
  updatedAt: string | null;
  updatedAtLabel: string;
}

export interface CashflowCumulativeCloseHeadRecoveryResponse {
  projectId: string;
  status: 'RECOVERED' | 'REPLAYED';
  statusLabel: string;
  recoveryAction: 'BACKFILLED' | 'REPAIRED' | 'VERIFIED';
  changed: boolean;
  replayed: boolean;
  guide: string;
}

export interface CashflowCumulativeCloseResetToRecloseResponse {
  projectId: string;
  yearMonth: string;
  status: 'RESET_TO_RECLOSE_COMPLETED' | 'RESET_TO_RECLOSE_REPLAYED';
  statusLabel: string;
  guide: string;
  nextAction: {
    type: string;
    label: string;
    href: string;
  };
}

type CashflowPeriodPolicyApiClient = Pick<PlatformApiClientLike, 'get' | 'patch' | 'post'>;

function apiClient(client?: CashflowPeriodPolicyApiClient): CashflowPeriodPolicyApiClient {
  return client || createPlatformApiClient();
}

function safeProjectId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.length > 512) {
    throw new Error('project ID is invalid');
  }
  return normalized;
}

function safeApproverUid(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) throw new Error('approver UID is invalid');
  return normalized;
}

function safeExpectedVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('expected version is invalid');
  return value;
}

function safeReason(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500) throw new Error('reason is invalid');
  return normalized;
}

function safeRecoveryExpectedEvidence(
  value: CashflowCumulativeCloseHeadRecoveryExpectedEvidence,
): CashflowCumulativeCloseHeadRecoveryExpectedEvidence {
  const sha256 = /^sha256:[a-f0-9]{64}$/;
  if (
    !value
    || value.contractVersion !== 'cashflow-cumulative-close-head-recovery-evidence-v1'
    || !sha256.test(value.authorityFingerprint)
    || !value.monthlyCloseId?.trim()
    || !value.monthlyCloseVersionId?.trim()
    || !value.requestId?.trim()
    || !Number.isSafeInteger(value.monthlyCloseRevision) || value.monthlyCloseRevision < 1
    || !Number.isSafeInteger(value.requestRevision) || value.requestRevision < 1
    || !sha256.test(value.sourceRevision)
    || !sha256.test(value.snapshotHash)
    || !sha256.test(value.rootHash)
    || !Number.isSafeInteger(value.headRevision) || value.headRevision < 1
  ) throw new Error('expected evidence is invalid');
  return value;
}

function safeResetToRecloseExpectedEvidence(
  value: CashflowCumulativeCloseResetToRecloseExpectedEvidence,
): CashflowCumulativeCloseResetToRecloseExpectedEvidence {
  const sha256 = /^sha256:[a-f0-9]{64}$/;
  const yearMonth = /^20\d{2}-(0[1-9]|1[0-2])$/;
  if (
    !value
    || value.contractVersion !== 'cashflow-cumulative-close-reset-to-reclose-evidence-v1'
    || !sha256.test(value.authorityFingerprint)
    || !sha256.test(value.monthlyCloseFingerprint)
    || !sha256.test(value.immutableEvidenceFingerprint)
    || !value.monthlyCloseId?.trim()
    || !yearMonth.test(value.yearMonth)
  ) throw new Error('reset-to-reclose evidence is invalid');
  return value;
}

function requestContext(tenantId: string, actor: ActorLike): { tenantId: string; actor: RequestActor } {
  return { tenantId, actor: toRequestActor(actor) };
}

export async function fetchCashflowPeriodPolicy(params: {
  tenantId: string;
  actor: ActorLike;
  client?: CashflowPeriodPolicyApiClient;
}): Promise<CashflowPeriodPolicyResponse> {
  const response = await apiClient(params.client).get<CashflowPeriodPolicyResponse>(
    '/api/v1/admin/cashflow-period-policy',
    {
      ...requestContext(params.tenantId, params.actor),
      retries: 0,
      timeoutMs: 12_000,
    },
  );
  return response.data;
}

export async function updateCashflowExecutiveApprover(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  approverUid: string;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
  client?: CashflowPeriodPolicyApiClient;
}): Promise<CashflowExecutiveApproverUpdateResponse> {
  const projectId = safeProjectId(params.projectId);
  const response = await apiClient(params.client).patch<CashflowExecutiveApproverUpdateResponse>(
    `/api/v1/admin/cashflow-period-policy/projects/${encodeURIComponent(projectId)}/executive-approver`,
    {
      ...requestContext(params.tenantId, params.actor),
      body: {
        approverUid: safeApproverUid(params.approverUid),
        expectedVersion: safeExpectedVersion(params.expectedVersion),
        reason: safeReason(params.reason),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 12_000,
    },
  );
  return response.data;
}

export async function recoverCashflowCumulativeCloseHead(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  reason: string;
  expectedEvidence: CashflowCumulativeCloseHeadRecoveryExpectedEvidence;
  idempotencyKey: string;
  client?: CashflowPeriodPolicyApiClient;
}): Promise<CashflowCumulativeCloseHeadRecoveryResponse> {
  const projectId = safeProjectId(params.projectId);
  const response = await apiClient(params.client).post<CashflowCumulativeCloseHeadRecoveryResponse>(
    `/api/v1/admin/cashflow-period-policy/projects/${encodeURIComponent(projectId)}/cumulative-close-head-recovery`,
    {
      ...requestContext(params.tenantId, params.actor),
      body: {
        reason: safeReason(params.reason),
        expectedEvidence: safeRecoveryExpectedEvidence(params.expectedEvidence),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 20_000,
    },
  );
  return response.data;
}

export async function resetCashflowCumulativeCloseToReclose(params: {
  tenantId: string;
  actor: ActorLike;
  projectId: string;
  reason: string;
  expectedEvidence: CashflowCumulativeCloseResetToRecloseExpectedEvidence;
  idempotencyKey: string;
  client?: CashflowPeriodPolicyApiClient;
}): Promise<CashflowCumulativeCloseResetToRecloseResponse> {
  const projectId = safeProjectId(params.projectId);
  const response = await apiClient(params.client).post<CashflowCumulativeCloseResetToRecloseResponse>(
    `/api/v1/admin/cashflow-period-policy/projects/${encodeURIComponent(projectId)}/cumulative-close-reset-to-reclose`,
    {
      ...requestContext(params.tenantId, params.actor),
      body: {
        reason: safeReason(params.reason),
        expectedEvidence: safeResetToRecloseExpectedEvidence(params.expectedEvidence),
      },
      idempotencyKey: params.idempotencyKey,
      retries: 0,
      timeoutMs: 20_000,
    },
  );
  return response.data;
}
