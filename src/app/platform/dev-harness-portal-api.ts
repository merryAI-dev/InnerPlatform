import { ORG_MEMBERS, PROJECTS } from '../data/mock-data';
import { resolveCurrentCashflowWeek } from './cashflow-export-surface';
import { buildPortalDashboardSurface } from './portal-dashboard-surface';
import type { WeeklySubmissionStatus } from '../data/types';

type PortalEntryProjectSummary = {
  id: string;
  name: string;
  status: string;
  clientOrg: string;
  managerName: string;
  department: string;
  type?: string;
};

type PortalEntryContextResult = {
  registrationState: 'registered' | 'unregistered';
  activeProjectId: string;
  priorityProjectIds: string[];
  projects: PortalEntryProjectSummary[];
};

type PortalOnboardingContextResult = {
  registrationState: 'registered' | 'unregistered';
  activeProjectId: string;
  projects: PortalEntryProjectSummary[];
};

type PortalRegistrationResult = {
  ok: boolean;
  registrationState: 'registered';
  activeProjectId: string;
  projectIds: string[];
};

type PortalSessionProjectResult = {
  ok: boolean;
  activeProjectId: string;
};

type PortalDashboardSummaryResult = {
  project: PortalEntryProjectSummary & {
    settlementType?: string;
    basis?: string;
    contractAmount?: number;
  };
  summary: {
    payrollRiskCount: number;
    visibleProjects: number;
    hrAlertCount: number;
    currentWeekLabel: string;
  };
  currentWeek: {
    label: string;
    weekStart: string;
    weekEnd: string;
    yearMonth: string;
    weekNo: number;
  } | null;
  surface: ReturnType<typeof buildPortalDashboardSurface>;
  financeSummaryItems: Array<{ label: string; value: string }>;
  submissionRows: Array<{
    id: string;
    name: string;
    shortName: string;
    projectionInputLabel: string;
    projectionDoneLabel: string;
    expenseLabel: string;
    expenseTone: 'neutral' | 'warning' | 'danger' | 'success';
    latestProjectionUpdatedAt?: string;
  }>;
  notices: {
    payrollAck: null;
    monthlyCloseAck: null;
    hrAlerts: {
      count: number;
      items: [];
      overflowCount: number;
    };
  };
  payrollQueue: {
    item: null;
    riskItems: [];
  };
  registrationState: 'registered' | 'unregistered';
};

type PortalPayrollSummaryResult = {
  project: PortalDashboardSummaryResult['project'];
  schedule: {
    id: string;
    projectId: string;
    dayOfMonth: number;
    timezone: string;
    noticeLeadBusinessDays: number;
    active: boolean;
  };
  currentRun: {
    id: string;
    projectId: string;
    yearMonth: string;
    plannedPayDate: string;
    noticeDate: string;
    noticeLeadBusinessDays: number;
    acknowledged: boolean;
    paidStatus: string;
    expectedPayrollAmount: number | null;
    baselineRunId: string | null;
    status: string;
    statusReason: string;
    dayBalances: Array<{ date: string; balance: number | null }>;
    worstBalance: number | null;
    currentBalance: number | null;
  } | null;
  summary: {
    queueCount: number;
    riskCount: number;
    status: string;
    statusReason: string;
  };
  queue: Array<NonNullable<PortalPayrollSummaryResult['currentRun']> & {
    projectName: string;
    projectShortName: string;
    runId: string;
    windowStart: string;
    windowEnd: string;
  }>;
  registrationState: 'registered' | 'unregistered';
};

type PortalWeeklyExpensesSummaryResult = {
  project: PortalDashboardSummaryResult['project'];
  summary: {
    currentWeekLabel: string;
    expenseReviewPendingCount: number;
  };
  expenseSheet: {
    activeSheetId: string;
    activeSheetName: string;
    sheetCount: number;
    rowCount: number;
  };
  bankStatement: {
    rowCount: number;
    columnCount: number;
    profile: string;
    lastSavedAt?: string;
  };
  sheetSources: Array<{
    sourceType: string;
    sheetName: string;
    fileName: string;
    rowCount: number;
    columnCount: number;
    uploadedAt?: string;
  }>;
  handoff: {
    canOpenWeeklyExpenses: boolean;
    canUseEvidenceWorkflow: boolean;
    nextPath: string;
  };
  registrationState: 'registered' | 'unregistered';
};

type PortalBankStatementsSummaryResult = {
  project: PortalDashboardSummaryResult['project'];
  bankStatement: {
    rowCount: number;
    columnCount: number;
    profile: string;
    lastSavedAt?: string;
  };
  handoffContext: {
    ready: boolean;
    reason: string;
    nextPath: string;
    activeExpenseSheetId: string;
    activeExpenseSheetName: string;
    sheetCount: number;
  };
  registrationState: 'registered' | 'unregistered';
};

type PortalWeeklyExpenseSaveCommand = {
  projectId: string;
  activeSheetId: string;
  activeSheetName: string;
  order: number;
  expectedVersion: number;
  rows: Array<{
    tempId: string;
    cells: string[];
    userEditedCells?: number[];
    reviewHints?: string[];
    reviewRequiredCellIndexes?: number[];
    reviewStatus?: string;
  }>;
  syncPlan: Array<{
    yearMonth: string;
    weekNo: number;
    amounts: Record<string, number>;
    reviewPendingCount: number;
  }>;
};

type PortalWeeklyExpenseSaveResult = {
  sheet: {
    id: string;
    projectId: string;
    name: string;
    version: number;
    rowCount: number;
    updatedAt: string;
  };
  weeklySubmissionStatuses: WeeklySubmissionStatus[];
  cashflowWeeks: Array<{
    id: string;
    projectId: string;
    yearMonth: string;
    weekNo: number;
    actual: Record<string, number>;
    updatedAt: string;
  }>;
  syncSummary: {
    expenseSyncState: 'pending' | 'review_required' | 'synced' | 'sync_failed';
    expenseReviewPendingCount: number;
    syncedWeekCount: number;
    reviewRequiredWeekCount: number;
  };
};

type PortalExpenseIntakeDraftSaveCommand = {
  projectId: string;
  intakeId: string;
  updates: {
    manualFields?: {
      expenseAmount?: number;
      budgetCategory?: string;
      budgetSubCategory?: string;
      cashflowLineId?: string;
      cashflowCategory?: string;
      memo?: string;
      evidenceCompletedDesc?: string;
    };
    existingExpenseSheetId?: string | null;
    existingExpenseRowTempId?: string | null;
    matchState?: 'AUTO_CONFIRMED' | 'PENDING_INPUT' | 'REVIEW_REQUIRED' | 'IGNORED';
    projectionStatus?: 'NOT_PROJECTED' | 'PROJECTED' | 'PROJECTED_WITH_PENDING_EVIDENCE';
    evidenceStatus?: 'MISSING' | 'PARTIAL' | 'COMPLETE';
    reviewReasons?: string[];
    lastUploadBatchId?: string;
  };
};

type PortalExpenseIntakeDraftSaveResult = {
  expenseIntakeItem: {
    id: string;
    projectId: string;
    sourceTxId: string;
    bankFingerprint: string;
    bankSnapshot: {
      accountNumber: string;
      dateTime: string;
      counterparty: string;
      memo: string;
      signedAmount: number;
      balanceAfter: number;
    };
    matchState: 'AUTO_CONFIRMED' | 'PENDING_INPUT' | 'REVIEW_REQUIRED' | 'IGNORED';
    projectionStatus: 'NOT_PROJECTED' | 'PROJECTED' | 'PROJECTED_WITH_PENDING_EVIDENCE';
    evidenceStatus: 'MISSING' | 'PARTIAL' | 'COMPLETE';
    manualFields: Record<string, string | number>;
    existingExpenseSheetId?: string;
    existingExpenseRowTempId?: string;
    reviewReasons: string[];
    lastUploadBatchId: string;
    createdAt: string;
    updatedAt: string;
    updatedBy: string;
    version: number;
  };
  summary: {
    updatedManualFieldCount: number;
    version: number;
  };
};

type PortalWeeklySubmissionSubmitCommand = {
  projectId: string;
  yearMonth: string;
  weekNo: number;
  transactionIds: string[];
};

type PortalWeeklySubmissionSubmitResult = {
  cashflowWeek: {
    id: string;
    projectId: string;
    yearMonth: string;
    weekNo: number;
    pmSubmitted: true;
    pmSubmittedAt: string;
    pmSubmittedByUid: string;
  };
  transactions: Array<{
    id: string;
    state: 'SUBMITTED';
    submittedAt: string;
    submittedBy: string;
    updatedAt: string;
    version: number;
  }>;
  summary: {
    submittedTransactionCount: number;
  };
};

type CloseCashflowWeekCommand = {
  projectId: string;
  yearMonth: string;
  weekNo: number;
};

type CloseCashflowWeekResult = {
  cashflowWeek: {
    id: string;
    projectId: string;
    yearMonth: string;
    weekNo: number;
    adminClosed: true;
    adminClosedAt: string;
    adminClosedByUid: string;
    version: number;
  };
  summary: {
    closedWeek: true;
  };
};

type UpsertCashflowWeekCommand = {
  projectId: string;
  yearMonth: string;
  weekNo: number;
  mode: 'projection' | 'actual';
  amounts: Record<string, number>;
};

type UpsertCashflowWeekResult = {
  cashflowWeek: {
    id: string;
    projectId: string;
    yearMonth: string;
    weekNo: number;
    projection: Record<string, number>;
    actual: Record<string, number>;
    pmSubmitted: boolean;
    adminClosed: boolean;
    updatedAt: string;
    updatedByUid: string;
    version: number;
  };
  summary: {
    mode: 'projection' | 'actual';
    updatedLineCount: number;
  };
};

type CashflowWeekVarianceFlagCommand = {
  sheetId: string;
  varianceFlag?: {
    status: 'OPEN' | 'REPLIED' | 'RESOLVED';
    reason: string;
    flaggedBy: string;
    flaggedByUid?: string;
    flaggedAt: string;
    pmReply?: string;
    pmRepliedBy?: string;
    pmRepliedByUid?: string;
    pmRepliedAt?: string;
    resolvedBy?: string;
    resolvedByUid?: string;
    resolvedAt?: string;
  };
  varianceHistory: Array<{
    id: string;
    action: 'FLAG' | 'REPLY' | 'RESOLVE';
    actor: string;
    actorUid?: string;
    content: string;
    timestamp: string;
  }>;
};

type CashflowWeekVarianceFlagResult = {
  cashflowWeek: {
    id: string;
    projectId: string;
    yearMonth: string;
    weekNo: number;
    varianceFlag?: CashflowWeekVarianceFlagCommand['varianceFlag'] | null;
    varianceHistory: CashflowWeekVarianceFlagCommand['varianceHistory'];
    updatedAt: string;
    updatedByUid: string;
    version: number;
  };
  summary: {
    hasVarianceFlag: boolean;
    varianceHistoryCount: number;
  };
};

type PortalBankStatementHandoffCommand = {
  projectId: string;
  activeSheetId: string;
  activeSheetName: string;
  order: number;
  columns: string[];
  rows: Array<{
    tempId: string;
    cells: string[];
    sourceTxId?: string;
  }>;
};

type PortalBankStatementHandoffResult = {
  bankStatement: {
    rowCount: number;
    columnCount: number;
    updatedAt: string;
  };
  sheet: {
    id: string;
    projectId: string;
    name: string;
    rowCount: number;
    version: number;
    updatedAt: string;
  };
  rows: Array<{
    tempId: string;
    sourceTxId: string;
    cells: string[];
  }>;
  expenseIntakeItems: Array<{
    id: string;
    projectId: string;
    sourceTxId: string;
  }>;
};

const PRIVILEGED_ROLES = new Set(['admin', 'finance']);
const DEV_HARNESS_TODAY_ISO = '2026-04-16';
const DEV_HARNESS_UPDATED_AT = '2026-04-16T12:00:00.000Z';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRole(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'viewer' ? 'pm' : normalized;
}

function normalizeProjectIds(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );
}

function resolvePrimaryProjectId(projectIds: string[], preferredProjectId?: string): string {
  const preferred = normalizeText(preferredProjectId);
  if (preferred && projectIds.includes(preferred)) return preferred;
  return projectIds[0] || '';
}

function resolveCashflowWeekIdParts(sheetId: string): { projectId: string; yearMonth: string; weekNo: number } | null {
  const normalized = normalizeText(sheetId);
  const match = normalized.match(/^(.*)-(\d{4}-\d{2})-w(\d+)$/);
  if (!match) return null;
  return {
    projectId: match[1],
    yearMonth: match[2],
    weekNo: Number.parseInt(match[3], 10),
  };
}

function resolveDefaultPmProjectId(): string {
  return PROJECTS.find((project) => project.status === 'CONTRACT_PENDING')?.id
    || PROJECTS[0]?.id
    || '';
}

function normalizeProject(project: Record<string, unknown>): PortalEntryProjectSummary {
  const id = normalizeText(project.id);
  return {
    id,
    name: normalizeText(project.name) || id,
    status: normalizeText(project.status) || 'CONTRACT_PENDING',
    clientOrg: normalizeText(project.clientOrg),
    managerName: normalizeText(project.managerName),
    department: normalizeText(project.department),
    type: normalizeText(project.type) || undefined,
  };
}

function fmtWon(value: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(value)}원`;
}

function buildHarnessWeeklyStatuses(projectIds: string[]): WeeklySubmissionStatus[] {
  const currentWeek = resolveCurrentCashflowWeek(DEV_HARNESS_TODAY_ISO);
  if (!currentWeek) return [];
  return projectIds.map((projectId, index) => {
    const edited = index === 0;
    const submitted = index === 0;
    const reviewRequired = index === 1;
    return {
      id: `${projectId}-${currentWeek.yearMonth}-w${currentWeek.weekNo}`,
      projectId,
      yearMonth: currentWeek.yearMonth,
      weekNo: currentWeek.weekNo,
      projectionEdited: edited,
      projectionUpdated: submitted,
      projectionUpdatedAt: edited ? '2026-04-15T02:30:00.000Z' : undefined,
      expenseEdited: true,
      expenseUpdated: !reviewRequired,
      expenseSyncState: reviewRequired ? 'review_required' : 'synced',
      expenseReviewPendingCount: reviewRequired ? 2 : 0,
      expenseUpdatedAt: !reviewRequired ? '2026-04-15T04:30:00.000Z' : undefined,
      updatedAt: '2026-04-15T04:30:00.000Z',
    };
  });
}

function resolveHarnessProjectContext(params: {
  actorId?: string;
  actorRole?: string;
  projectId?: string;
}) {
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'pm')?.uid || 'u002';
  const actorRole = normalizeRole(params.actorRole) || 'pm';
  const context = buildDevHarnessPortalEntryContext({ actorId, actorRole });
  const requestedProjectId = normalizeText(params.projectId);
  const targetProjectId = requestedProjectId || context.activeProjectId;
  const currentProject = context.projects.find((project) => project.id === targetProjectId);
  if (!currentProject) {
    throw new Error('project_not_found');
  }
  const projectRecord = PROJECTS.find((project) => project.id === currentProject.id);
  return {
    actorId,
    actorRole,
    context,
    currentProject,
    projectRecord,
  };
}

function buildHarnessProjectReadModel(
  project: PortalEntryProjectSummary,
  projectRecord?: Record<string, unknown>,
): PortalDashboardSummaryResult['project'] {
  return {
    ...project,
    settlementType: normalizeText(projectRecord?.settlementType) || undefined,
    basis: normalizeText(projectRecord?.basis) || undefined,
    contractAmount: typeof projectRecord?.contractAmount === 'number' ? projectRecord.contractAmount : undefined,
  };
}

function listVisibleProjects(actorId: string, actorRole: string): {
  projects: PortalEntryProjectSummary[];
  priorityProjectIds: string[];
} {
  const activeProjects = PROJECTS.filter((project) => !normalizeText((project as unknown as Record<string, unknown>).trashedAt));
  if (PRIVILEGED_ROLES.has(actorRole)) {
    return {
      projects: activeProjects
        .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
        .sort((left, right) => left.name.localeCompare(right.name, 'ko')),
      priorityProjectIds: [],
    };
  }

  const assignedProjectIds = normalizeProjectIds([resolveDefaultPmProjectId()]);
  const projects = activeProjects
    .filter((project) => assignedProjectIds.includes(project.id) || normalizeText(project.managerId) === actorId)
    .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));

  const priorityProjectIds = normalizeProjectIds([
    ...assignedProjectIds,
    ...projects
      .filter((project) => normalizeText(project.id))
      .map((project) => project.id),
  ]);

  return { projects, priorityProjectIds };
}

function resolveRegistrationState(actorRole: string, projectIds: string[]): 'registered' | 'unregistered' {
  if (PRIVILEGED_ROLES.has(actorRole)) return 'registered';
  return projectIds.length > 0 ? 'registered' : 'unregistered';
}

export function buildDevHarnessPortalEntryContext(params: {
  actorId?: string;
  actorRole?: string;
}): PortalEntryContextResult {
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'pm')?.uid || 'u002';
  const actorRole = normalizeRole(params.actorRole) || 'pm';
  const { projects, priorityProjectIds } = listVisibleProjects(actorId, actorRole);
  const activeProjectId = resolvePrimaryProjectId(priorityProjectIds, priorityProjectIds[0]);

  return {
    registrationState: resolveRegistrationState(actorRole, priorityProjectIds),
    activeProjectId,
    priorityProjectIds,
    projects,
  };
}

export function buildDevHarnessPortalOnboardingContext(params: {
  actorRole?: string;
}): PortalOnboardingContextResult {
  const actorRole = normalizeRole(params.actorRole) || 'pm';
  const projects = PROJECTS
    .filter((project) => !normalizeText((project as unknown as Record<string, unknown>).trashedAt))
    .map((project) => normalizeProject(project as unknown as Record<string, unknown>))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  const defaultProjectIds = PRIVILEGED_ROLES.has(actorRole) ? [] : normalizeProjectIds([resolveDefaultPmProjectId()]);

  return {
    registrationState: resolveRegistrationState(actorRole, defaultProjectIds),
    activeProjectId: resolvePrimaryProjectId(defaultProjectIds, defaultProjectIds[0]),
    projects,
  };
}

export function buildDevHarnessPortalSessionProjectResult(projectId: string): PortalSessionProjectResult {
  const normalizedProjectId = normalizeText(projectId);
  const exists = PROJECTS.some((project) => project.id === normalizedProjectId);
  if (!exists) {
    throw new Error('project_not_found');
  }
  return {
    ok: true,
    activeProjectId: normalizedProjectId,
  };
}

export function buildDevHarnessPortalDashboardSummary(params: {
  actorId?: string;
  actorRole?: string;
  projectId?: string;
}): PortalDashboardSummaryResult {
  const { context, currentProject, projectRecord } = resolveHarnessProjectContext(params);
  const currentWeek = resolveCurrentCashflowWeek(DEV_HARNESS_TODAY_ISO);
  const weeklyStatuses = buildHarnessWeeklyStatuses(context.projects.map((project) => project.id));
  const surface = buildPortalDashboardSurface({
    projectId: currentProject.id,
    weeklySubmissionStatuses: weeklyStatuses,
    todayIso: DEV_HARNESS_TODAY_ISO,
    hrAlertCount: 0,
    payrollRiskCount: 0,
  });

  return {
    project: buildHarnessProjectReadModel(currentProject, projectRecord),
    summary: {
      payrollRiskCount: 0,
      visibleProjects: context.projects.length,
      hrAlertCount: 0,
      currentWeekLabel: surface.currentWeekLabel,
    },
    currentWeek: currentWeek
      ? {
        label: `${currentWeek.weekNo}주차`,
        weekStart: currentWeek.weekStart,
        weekEnd: currentWeek.weekEnd,
        yearMonth: currentWeek.yearMonth,
        weekNo: currentWeek.weekNo,
      }
      : null,
    surface,
    financeSummaryItems: [
      { label: '총 입금', value: fmtWon(Number(projectRecord?.contractAmount || 0)) },
      { label: '총 출금', value: fmtWon(Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.6)) },
      { label: '잔액', value: fmtWon(Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.4)) },
      { label: '소진율', value: projectRecord?.budgetCurrentYear ? '60%' : '-' },
    ],
    submissionRows: context.projects.map((project, index) => {
      const status = weeklyStatuses.find((row) => row.projectId === project.id);
      const surfaceForProject = buildPortalDashboardSurface({
        projectId: project.id,
        weeklySubmissionStatuses: weeklyStatuses,
        todayIso: DEV_HARNESS_TODAY_ISO,
        hrAlertCount: 0,
        payrollRiskCount: 0,
      });
      return {
        id: project.id,
        name: project.name,
        shortName: project.name,
        projectionInputLabel: status?.projectionEdited ? '입력됨' : '미입력',
        projectionDoneLabel: status?.projectionUpdated ? '제출 완료' : '미제출',
        expenseLabel: surfaceForProject.expense.label,
        expenseTone: surfaceForProject.expense.tone === 'muted' ? 'neutral' : surfaceForProject.expense.tone,
        latestProjectionUpdatedAt: status?.projectionUpdatedAt,
      };
    }),
    notices: {
      payrollAck: null,
      monthlyCloseAck: null,
      hrAlerts: {
        count: 0,
        items: [],
        overflowCount: 0,
      },
    },
    payrollQueue: {
      item: null,
      riskItems: [],
    },
    registrationState: context.registrationState,
  };
}

export function buildDevHarnessPortalPayrollSummary(params: {
  actorId?: string;
  actorRole?: string;
  projectId?: string;
}): PortalPayrollSummaryResult {
  const { context, currentProject, projectRecord } = resolveHarnessProjectContext(params);
  const schedule = {
    id: `${currentProject.id}-schedule`,
    projectId: currentProject.id,
    dayOfMonth: 25,
    timezone: 'Asia/Seoul',
    noticeLeadBusinessDays: 3,
    active: true,
  };
  const currentRun = {
    id: `${currentProject.id}-run-2026-04`,
    projectId: currentProject.id,
    yearMonth: '2026-04',
    plannedPayDate: '2026-04-25',
    noticeDate: '2026-04-22',
    noticeLeadBusinessDays: 3,
    acknowledged: false,
    paidStatus: 'PENDING',
    expectedPayrollAmount: Math.max(1_200_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.08)),
    baselineRunId: `${currentProject.id}-run-2026-03`,
    status: 'payment_unconfirmed',
    statusReason: '지급일이 다가와 잔액과 지급 상태를 함께 점검해야 합니다.',
    dayBalances: [
      { date: '2026-04-22', balance: Math.max(2_400_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.15)) },
      { date: '2026-04-25', balance: Math.max(1_900_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.12)) },
      { date: '2026-04-28', balance: Math.max(1_600_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.1)) },
    ],
    worstBalance: Math.max(1_600_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.1)),
    currentBalance: Math.max(1_900_000, Math.floor(Number(projectRecord?.budgetCurrentYear || 0) * 0.12)),
  };
  return {
    project: buildHarnessProjectReadModel(currentProject, projectRecord),
    schedule,
    currentRun,
    summary: {
      queueCount: 1,
      riskCount: 1,
      status: currentRun.status,
      statusReason: currentRun.statusReason,
    },
    queue: [{
      ...currentRun,
      projectName: currentProject.name,
      projectShortName: currentProject.name,
      runId: currentRun.id,
      windowStart: '2026-04-22',
      windowEnd: '2026-04-28',
    }],
    registrationState: context.registrationState,
  };
}

export function buildDevHarnessPortalWeeklyExpensesSummary(params: {
  actorId?: string;
  actorRole?: string;
  projectId?: string;
}): PortalWeeklyExpensesSummaryResult {
  const { context, currentProject, projectRecord } = resolveHarnessProjectContext(params);
  const currentWeek = resolveCurrentCashflowWeek(DEV_HARNESS_TODAY_ISO);
  return {
    project: buildHarnessProjectReadModel(currentProject, projectRecord),
    summary: {
      currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
      expenseReviewPendingCount: 2,
    },
    expenseSheet: {
      activeSheetId: 'default',
      activeSheetName: '기본 탭',
      sheetCount: 1,
      rowCount: 6,
    },
    bankStatement: {
      rowCount: 12,
      columnCount: 6,
      profile: 'generic',
      lastSavedAt: '2026-04-15T04:30:00.000Z',
    },
    sheetSources: [
      {
        sourceType: 'bank_statement',
        sheetName: '원본 업로드',
        fileName: 'bank-statement-apr.xlsx',
        rowCount: 12,
        columnCount: 6,
        uploadedAt: '2026-04-15T04:00:00.000Z',
      },
      {
        sourceType: 'evidence_rules',
        sheetName: '증빙 규칙',
        fileName: 'evidence-rules.xlsx',
        rowCount: 4,
        columnCount: 3,
        uploadedAt: '2026-04-15T04:05:00.000Z',
      },
    ],
    handoff: {
      canOpenWeeklyExpenses: true,
      canUseEvidenceWorkflow: true,
      nextPath: '/portal/bank-statements',
    },
    registrationState: context.registrationState,
  };
}

export function buildDevHarnessPortalSaveWeeklyExpenseResult(params: {
  actorId?: string;
  actorRole?: string;
  command: PortalWeeklyExpenseSaveCommand;
}): PortalWeeklyExpenseSaveResult {
  const command = params.command;
  const { currentProject } = resolveHarnessProjectContext({
    actorId: params.actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });
  const syncPlan = Array.isArray(command.syncPlan) ? command.syncPlan : [];
  const weeklySubmissionStatuses = syncPlan.map((item) => ({
    id: `${currentProject.id}-${item.yearMonth}-w${item.weekNo}`,
    projectId: currentProject.id,
    yearMonth: item.yearMonth,
    weekNo: item.weekNo,
    expenseEdited: true,
    expenseUpdated: true,
    expenseSyncState: item.reviewPendingCount > 0 ? 'review_required' : 'synced',
    expenseReviewPendingCount: item.reviewPendingCount,
    expenseUpdatedAt: DEV_HARNESS_UPDATED_AT,
    updatedAt: DEV_HARNESS_UPDATED_AT,
  } satisfies WeeklySubmissionStatus));
  const cashflowWeeks = syncPlan.map((item) => ({
    id: `${currentProject.id}-${item.yearMonth}-w${item.weekNo}`,
    projectId: currentProject.id,
    yearMonth: item.yearMonth,
    weekNo: item.weekNo,
    actual: item.amounts,
    updatedAt: DEV_HARNESS_UPDATED_AT,
  }));
  const reviewRequiredWeekCount = syncPlan.filter((item) => item.reviewPendingCount > 0).length;
  const syncedWeekCount = syncPlan.filter((item) => item.reviewPendingCount <= 0).length;
  const expenseReviewPendingCount = syncPlan.reduce((sum, item) => sum + Math.max(0, Number(item.reviewPendingCount) || 0), 0);

  return {
    sheet: {
      id: command.activeSheetId,
      projectId: currentProject.id,
      name: command.activeSheetName,
      version: Math.max(1, Number(command.expectedVersion) + 1),
      rowCount: Array.isArray(command.rows) ? command.rows.length : 0,
      updatedAt: DEV_HARNESS_UPDATED_AT,
    },
    weeklySubmissionStatuses,
    cashflowWeeks,
    syncSummary: {
      expenseSyncState: reviewRequiredWeekCount > 0 ? 'review_required' : 'synced',
      expenseReviewPendingCount,
      syncedWeekCount,
      reviewRequiredWeekCount,
    },
  };
}

export function buildDevHarnessPortalExpenseIntakeDraftResult(params: {
  actorId?: string;
  actorRole?: string;
  command: PortalExpenseIntakeDraftSaveCommand;
}): PortalExpenseIntakeDraftSaveResult {
  const command = params.command;
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'pm')?.uid || 'u002';
  const { currentProject } = resolveHarnessProjectContext({
    actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });
  const updates = command.updates && typeof command.updates === 'object' ? command.updates : {};
  const manualFields = updates.manualFields && typeof updates.manualFields === 'object' ? updates.manualFields : {};
  const reviewReasons = Array.isArray(updates.reviewReasons)
    ? updates.reviewReasons.map((reason) => normalizeText(reason)).filter(Boolean)
    : [];

  return {
    expenseIntakeItem: {
      id: normalizeText(command.intakeId) || 'fp-1',
      projectId: currentProject.id,
      sourceTxId: `bank:${normalizeText(command.intakeId) || 'fp-1'}`,
      bankFingerprint: normalizeText(command.intakeId) || 'fp-1',
      bankSnapshot: {
        accountNumber: '123-456',
        dateTime: '2026-04-16 09:00',
        counterparty: '테스트 상호',
        memo: '기존 메모',
        signedAmount: -125000,
        balanceAfter: 900000,
      },
      matchState: updates.matchState || 'PENDING_INPUT',
      projectionStatus: updates.projectionStatus || 'NOT_PROJECTED',
      evidenceStatus: updates.evidenceStatus || 'MISSING',
      manualFields: {
        ...(manualFields.budgetCategory ? { budgetCategory: manualFields.budgetCategory } : {}),
        ...(manualFields.budgetSubCategory ? { budgetSubCategory: manualFields.budgetSubCategory } : {}),
        ...(manualFields.memo ? { memo: manualFields.memo } : {}),
        ...(manualFields.evidenceCompletedDesc ? { evidenceCompletedDesc: manualFields.evidenceCompletedDesc } : {}),
        ...(typeof manualFields.expenseAmount === 'number' ? { expenseAmount: manualFields.expenseAmount } : {}),
        ...(manualFields.cashflowLineId ? { cashflowLineId: manualFields.cashflowLineId } : {}),
        ...(manualFields.cashflowCategory ? { cashflowCategory: manualFields.cashflowCategory } : {}),
      },
      ...(updates.existingExpenseSheetId ? { existingExpenseSheetId: updates.existingExpenseSheetId } : {}),
      ...(updates.existingExpenseRowTempId ? { existingExpenseRowTempId: updates.existingExpenseRowTempId } : {}),
      reviewReasons,
      lastUploadBatchId: normalizeText(updates.lastUploadBatchId) || 'batch-1',
      createdAt: '2026-04-16T18:00:00.000Z',
      updatedAt: DEV_HARNESS_UPDATED_AT,
      updatedBy: actorId,
      version: 3,
    },
    summary: {
      updatedManualFieldCount: Object.keys(manualFields).length,
      version: 3,
    },
  };
}

export function buildDevHarnessPortalSubmitWeeklySubmissionResult(params: {
  actorId?: string;
  actorRole?: string;
  command: PortalWeeklySubmissionSubmitCommand;
}): PortalWeeklySubmissionSubmitResult {
  const command = params.command;
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'pm')?.uid || 'u002';
  const { currentProject } = resolveHarnessProjectContext({
    actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });
  const transactionIds = Array.isArray(command.transactionIds) ? command.transactionIds.filter((id) => normalizeText(id)) : [];

  return {
    cashflowWeek: {
      id: `${currentProject.id}-${command.yearMonth}-w${command.weekNo}`,
      projectId: currentProject.id,
      yearMonth: command.yearMonth,
      weekNo: command.weekNo,
      pmSubmitted: true,
      pmSubmittedAt: DEV_HARNESS_UPDATED_AT,
      pmSubmittedByUid: actorId,
    },
    transactions: transactionIds.map((id) => ({
      id,
      state: 'SUBMITTED',
      submittedAt: DEV_HARNESS_UPDATED_AT,
      submittedBy: actorId,
      updatedAt: DEV_HARNESS_UPDATED_AT,
      version: 4,
    })),
    summary: {
      submittedTransactionCount: transactionIds.length,
    },
  };
}

export function buildDevHarnessPortalCloseCashflowWeekResult(params: {
  actorId?: string;
  actorRole?: string;
  command: CloseCashflowWeekCommand;
}): CloseCashflowWeekResult {
  const command = params.command;
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'admin')?.uid || 'admin-1';
  const { currentProject } = resolveHarnessProjectContext({
    actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });

  return {
    cashflowWeek: {
      id: `${currentProject.id}-${command.yearMonth}-w${command.weekNo}`,
      projectId: currentProject.id,
      yearMonth: command.yearMonth,
      weekNo: command.weekNo,
      adminClosed: true,
      adminClosedAt: DEV_HARNESS_UPDATED_AT,
      adminClosedByUid: actorId,
      version: 8,
    },
    summary: {
      closedWeek: true,
    },
  };
}

export function buildDevHarnessPortalVarianceFlagResult(params: {
  actorId?: string;
  actorRole?: string;
  command: CashflowWeekVarianceFlagCommand;
}): CashflowWeekVarianceFlagResult {
  const command = params.command;
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'admin')?.uid || 'admin-1';
  const sheetParts = resolveCashflowWeekIdParts(command.sheetId);
  const { currentProject } = resolveHarnessProjectContext({
    actorId,
    actorRole: params.actorRole,
    projectId: sheetParts?.projectId || undefined,
  });

  return {
    cashflowWeek: {
      id: normalizeText(command.sheetId) || `${currentProject.id}-2026-04-w3`,
      projectId: sheetParts?.projectId || currentProject.id,
      yearMonth: sheetParts?.yearMonth || '2026-04',
      weekNo: sheetParts?.weekNo || 3,
      varianceFlag: command.varianceFlag,
      varianceHistory: Array.isArray(command.varianceHistory) ? command.varianceHistory : [],
      updatedAt: DEV_HARNESS_UPDATED_AT,
      updatedByUid: actorId,
      version: 6,
    },
    summary: {
      hasVarianceFlag: Boolean(command.varianceFlag),
      varianceHistoryCount: Array.isArray(command.varianceHistory) ? command.varianceHistory.length : 0,
    },
  };
}

export function buildDevHarnessPortalUpsertCashflowWeekResult(params: {
  actorId?: string;
  actorRole?: string;
  command: UpsertCashflowWeekCommand;
}): UpsertCashflowWeekResult {
  const command = params.command;
  const actorId = normalizeText(params.actorId) || ORG_MEMBERS.find((member) => member.role === 'admin')?.uid || 'admin-1';
  const { currentProject } = resolveHarnessProjectContext({
    actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });

  return {
    cashflowWeek: {
      id: `${currentProject.id}-${command.yearMonth}-w${command.weekNo}`,
      projectId: currentProject.id,
      yearMonth: command.yearMonth,
      weekNo: command.weekNo,
      projection: command.mode === 'projection' ? { ...command.amounts } : {},
      actual: command.mode === 'actual' ? { ...command.amounts } : {},
      pmSubmitted: false,
      adminClosed: false,
      updatedAt: DEV_HARNESS_UPDATED_AT,
      updatedByUid: actorId,
      version: 6,
    },
    summary: {
      mode: command.mode,
      updatedLineCount: Object.keys(command.amounts || {}).length,
    },
  };
}

export function buildDevHarnessPortalBankStatementHandoffResult(params: {
  actorId?: string;
  actorRole?: string;
  command: PortalBankStatementHandoffCommand;
}): PortalBankStatementHandoffResult {
  const command = params.command;
  const { currentProject } = resolveHarnessProjectContext({
    actorId: params.actorId,
    actorRole: params.actorRole,
    projectId: command.projectId,
  });
  const rows = (Array.isArray(command.rows) ? command.rows : []).map((row, index) => ({
    tempId: row.tempId,
    sourceTxId: row.sourceTxId || `bank:${index + 1}`,
    cells: row.cells,
  }));

  return {
    bankStatement: {
      rowCount: rows.length,
      columnCount: Array.isArray(command.columns) ? command.columns.length : 0,
      updatedAt: DEV_HARNESS_UPDATED_AT,
    },
    sheet: {
      id: command.activeSheetId,
      projectId: currentProject.id,
      name: command.activeSheetName,
      rowCount: rows.length,
      version: 3,
      updatedAt: DEV_HARNESS_UPDATED_AT,
    },
    rows,
    expenseIntakeItems: rows.map((row, index) => ({
      id: `intake-${index + 1}`,
      projectId: currentProject.id,
      sourceTxId: row.sourceTxId,
    })),
  };
}

export function buildDevHarnessPortalBankStatementsSummary(params: {
  actorId?: string;
  actorRole?: string;
  projectId?: string;
}): PortalBankStatementsSummaryResult {
  const { context, currentProject, projectRecord } = resolveHarnessProjectContext(params);
  return {
    project: buildHarnessProjectReadModel(currentProject, projectRecord),
    bankStatement: {
      rowCount: 12,
      columnCount: 6,
      profile: 'generic',
      lastSavedAt: '2026-04-15T04:30:00.000Z',
    },
    handoffContext: {
      ready: true,
      reason: '저장된 통장내역이 있습니다.',
      nextPath: '/portal/weekly-expenses',
      activeExpenseSheetId: 'default',
      activeExpenseSheetName: '기본 탭',
      sheetCount: 1,
    },
    registrationState: context.registrationState,
  };
}

export function buildDevHarnessPortalRegistrationResult(params: {
  projectId?: string;
  projectIds?: string[];
}): PortalRegistrationResult {
  const normalizedProjectIds = normalizeProjectIds([
    ...(Array.isArray(params.projectIds) ? params.projectIds : []),
    params.projectId,
  ]);
  const activeProjectId = resolvePrimaryProjectId(normalizedProjectIds, params.projectId || normalizedProjectIds[0]);
  if (!activeProjectId) {
    throw new Error('project_required');
  }

  return {
    ok: true,
    registrationState: 'registered',
    activeProjectId,
    projectIds: normalizedProjectIds,
  };
}
