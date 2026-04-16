import type { WeeklySubmissionStatus } from '../data/types';
import { resolveCurrentCashflowWeek } from './cashflow-export-surface';
import {
  resolveWeeklyAccountingProductStatus,
  resolveWeeklyAccountingSnapshot,
} from './weekly-accounting-state';

export interface PortalDashboardIssue {
  label: string;
  count: number;
  tone: 'neutral' | 'warn' | 'danger';
  to: string;
}

export interface PortalDashboardSurface {
  currentWeekLabel: string;
  projection: {
    label: '작성됨' | '미작성';
    detail: string;
    latestUpdatedAt?: string;
  };
  expense: {
    label: string;
    detail: string;
    tone: 'muted' | 'warning' | 'danger' | 'success';
  };
  visibleIssues: PortalDashboardIssue[];
}

function buildStatusKey(projectId: string, yearMonth: string, weekNo: number): string {
  return `${projectId}-${yearMonth}-w${weekNo}`;
}

export function buildPortalDashboardSurface(input: {
  projectId: string;
  weeklySubmissionStatuses: WeeklySubmissionStatus[];
  todayIso: string;
  hrAlertCount: number;
  payrollRiskCount: number;
}): PortalDashboardSurface {
  const projectStatuses = input.weeklySubmissionStatuses.filter((status) => status.projectId === input.projectId);
  const currentWeek = resolveCurrentCashflowWeek(input.todayIso);
  const statusMap = new Map<string, WeeklySubmissionStatus>();

  for (const status of projectStatuses) {
    statusMap.set(buildStatusKey(status.projectId, status.yearMonth, status.weekNo), status);
  }

  const currentStatus = currentWeek
    ? statusMap.get(buildStatusKey(input.projectId, currentWeek.yearMonth, currentWeek.weekNo))
    : undefined;
  const snapshot = resolveWeeklyAccountingSnapshot(currentStatus);
  const accountingStatus = resolveWeeklyAccountingProductStatus({ snapshot });
  const latestProjectionUpdatedAt = projectStatuses.reduce<string | undefined>((latest, status) => {
    if (!status.projectionUpdatedAt) return latest;
    if (!latest || status.projectionUpdatedAt > latest) return status.projectionUpdatedAt;
    return latest;
  }, undefined);

  const currentWeekLabel = currentWeek ? `${currentWeek.weekNo}주차` : '-';
  const visibleIssues: PortalDashboardIssue[] = [
    {
      label: '미확인 공지',
      count: input.hrAlertCount,
      tone: 'warn',
      to: '/portal/change-requests',
    },
    {
      label: '인건비 Queue',
      count: input.payrollRiskCount,
      tone: 'danger',
      to: '/portal/payroll',
    },
  ].filter((item): item is PortalDashboardIssue => item.count > 0);

  return {
    currentWeekLabel,
    projection: {
      label: snapshot.projectionEdited ? '작성됨' : '미작성',
      detail: currentWeek
        ? `${currentWeekLabel} · ${snapshot.projectionDone ? '제출 완료' : '미제출'}`
        : '이번 주 주차를 찾지 못했습니다.',
      latestUpdatedAt: latestProjectionUpdatedAt,
    },
    expense: {
      label: accountingStatus.label,
      detail: currentWeek ? `${currentWeekLabel} · ${accountingStatus.description}` : accountingStatus.description,
      tone: accountingStatus.tone,
    },
    visibleIssues,
  };
}
