import type { ProjectFundInputMode, WeeklySubmissionStatus } from '../data/types';

export type PortalMissionStepStatus = 'complete' | 'active' | 'locked' | 'attention';

export interface PortalMissionStep {
  id: 'prepare' | 'save' | 'sync';
  order: number;
  title: string;
  description: string;
  status: PortalMissionStepStatus;
  ctaLabel?: string;
  ctaPath?: string;
}

export interface PortalMissionProgress {
  title: string;
  subtitle: string;
  currentLabel: string;
  steps: PortalMissionStep[];
  activeStep: PortalMissionStep;
  completedCount: number;
}

interface ResolvePortalMissionProgressInput {
  fundInputMode: ProjectFundInputMode;
  bankStatementRowCount: number;
  expenseRowCount: number;
  weeklySubmissionStatuses: WeeklySubmissionStatus[];
}

function buildStepStatus(
  order: number,
  activeOrder: number,
  completed: boolean,
  attention: boolean = false,
): PortalMissionStepStatus {
  if (completed) return 'complete';
  if (attention) return 'attention';
  if (order === activeOrder) return 'active';
  return 'locked';
}

export function resolvePortalMissionProgress(
  input: ResolvePortalMissionProgressInput,
): PortalMissionProgress {
  const sourcePrepared = input.fundInputMode === 'DIRECT_ENTRY'
    ? input.expenseRowCount > 0
    : input.bankStatementRowCount > 0;
  const hasSavedWeeklySheet = input.weeklySubmissionStatuses.some((status) => (
    Boolean(status.expenseUpdated)
    || Boolean(status.expenseEdited)
    || Boolean(status.expenseSyncState)
  ));
  const hasSynced = input.weeklySubmissionStatuses.some((status) => status.expenseSyncState === 'synced');
  const hasReviewRequired = input.weeklySubmissionStatuses.some((status) => status.expenseSyncState === 'review_required');
  const hasSyncFailed = input.weeklySubmissionStatuses.some((status) => status.expenseSyncState === 'sync_failed');

  let activeOrder = 1;
  if (sourcePrepared) activeOrder = 2;
  if (hasSavedWeeklySheet) activeOrder = 3;
  if (hasSynced) activeOrder = 3;

  const prepareStep: PortalMissionStep = {
    id: 'prepare',
    order: 1,
    title: input.fundInputMode === 'DIRECT_ENTRY' ? '첫 행 만들기' : '원본 올리기',
    description: input.fundInputMode === 'DIRECT_ENTRY'
      ? '주간 사업비 표에서 입금, 지출 또는 조정 행을 한 줄이라도 추가해 작업을 시작하세요.'
      : '통장내역 화면에서 CSV 또는 엑셀 원본을 올리면 이번 주 입력의 시작점이 준비됩니다.',
    status: buildStepStatus(1, activeOrder, sourcePrepared),
    ctaLabel: input.fundInputMode === 'DIRECT_ENTRY' ? '주간 사업비 열기' : '통장내역 열기',
    ctaPath: input.fundInputMode === 'DIRECT_ENTRY' ? '/portal/weekly-expenses' : '/portal/bank-statements',
  };

  const saveStep: PortalMissionStep = {
    id: 'save',
    order: 2,
    title: '주간 시트 저장하기',
    description: '행을 정리한 뒤 저장하면 예산과 캐시플로 계산에 반영할 준비가 끝납니다.',
    status: buildStepStatus(2, activeOrder, hasSavedWeeklySheet),
    ctaLabel: '사업비 입력(주간) 열기',
    ctaPath: '/portal/weekly-expenses',
  };

  const syncDescription = hasSyncFailed
    ? '시트 저장은 끝났지만 캐시플로 반영은 실패했습니다. 저장 상태를 확인하고 다시 시도하세요.'
    : hasReviewRequired
      ? '사람 확인이 필요한 행이 있어 일부 주차는 보류 상태입니다. 확인 후 다시 저장하면 반영됩니다.'
      : '저장 후 예산 편집과 캐시플로(주간)에서 반영 상태를 확인하세요.';
  const syncStep: PortalMissionStep = {
    id: 'sync',
    order: 3,
    title: hasSyncFailed ? '동기화 다시 확인' : hasReviewRequired ? '사람 확인 후 반영' : '반영 상태 확인',
    description: syncDescription,
    status: buildStepStatus(3, activeOrder, hasSynced, hasSyncFailed || hasReviewRequired),
    ctaLabel: hasSyncFailed || hasReviewRequired ? '사업비 입력(주간) 확인' : '예산 편집 열기',
    ctaPath: hasSyncFailed || hasReviewRequired ? '/portal/weekly-expenses' : '/portal/budget',
  };

  const steps = [prepareStep, saveStep, syncStep];
  const activeStep = steps.find((step) => step.status === 'active' || step.status === 'attention') || steps[steps.length - 1];

  return {
    title: '이번 주 미션',
    subtitle: input.fundInputMode === 'DIRECT_ENTRY'
      ? '직접 입력형 프로젝트용 단계 안내'
      : '통장내역 기반 프로젝트용 단계 안내',
    currentLabel: hasSyncFailed
      ? '시트는 저장됐지만 반영 확인이 남았습니다.'
      : hasReviewRequired
        ? '저장 이후 사람 확인 단계가 남아 있습니다.'
        : activeStep.order === 1
          ? '첫 입력을 시작하면 다음 단계가 열립니다.'
          : activeStep.order === 2
            ? '저장까지 끝나야 예산과 캐시플로가 같은 기준으로 움직입니다.'
            : '마지막으로 반영 상태를 확인하면 이번 주 시작 준비가 끝납니다.',
    steps,
    activeStep,
    completedCount: steps.filter((step) => step.status === 'complete').length,
  };
}
