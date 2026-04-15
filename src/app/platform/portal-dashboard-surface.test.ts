import { describe, expect, it } from 'vitest';
import { buildPortalDashboardSurface } from './portal-dashboard-surface';
import type { WeeklySubmissionStatus } from '../data/types';

function makeStatus(overrides: Partial<WeeklySubmissionStatus> = {}): WeeklySubmissionStatus {
  return {
    id: 'project-1-2026-04-w2',
    projectId: 'project-1',
    yearMonth: '2026-04',
    weekNo: 2,
    projectionEdited: false,
    projectionUpdated: false,
    expenseUpdated: true,
    expenseSyncState: 'synced',
    projectionUpdatedAt: '2026-04-08T02:30:00.000Z',
    expenseUpdatedAt: '2026-04-08T04:30:00.000Z',
    ...overrides,
  };
}

describe('portal dashboard surface', () => {
  it('hides zero-count issue cards and exposes current week projection/expense state', () => {
    const surface = buildPortalDashboardSurface({
      projectId: 'project-1',
      weeklySubmissionStatuses: [makeStatus()],
      todayIso: '2026-04-08',
      hrAlertCount: 0,
      payrollRiskCount: 0,
    });

    expect(surface.visibleIssues).toEqual([]);
    expect(surface.currentWeekLabel).toBe('2주차');
    expect(surface.projection.label).toBe('미작성');
    expect(surface.projection.latestUpdatedAt).toBe('2026-04-08T02:30:00.000Z');
    expect(surface.expense.label).toBe('동기화 완료');
  });

  it('keeps only non-zero issue items in the surfaced list', () => {
    const surface = buildPortalDashboardSurface({
      projectId: 'project-1',
      weeklySubmissionStatuses: [makeStatus({ projectionEdited: true, projectionUpdated: true })],
      todayIso: '2026-04-08',
      hrAlertCount: 0,
      payrollRiskCount: 1,
    });

    expect(surface.visibleIssues).toEqual([
      { label: '인건비 Queue', count: 1, tone: 'danger', to: '/portal/payroll' },
    ]);
  });
});
