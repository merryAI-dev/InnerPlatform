export type CashflowOpsTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export type CashflowOpsWeek = {
  key: string;
  label: string;
  weekStart: string;
  weekEnd: string;
  projectionWritten: boolean;
  actualWritten: boolean;
  adminClosed: boolean;
  updatedAt?: string;
  updatedByName?: string;
  projectionUpdatedAt?: string;
  projectionUpdatedByName?: string;
  pmSubmittedAt?: string;
  pmSubmittedByName?: string;
  adminClosedAt?: string;
  adminClosedByName?: string;
};

export type CashflowOpsItem = {
  id: string;
  tone: CashflowOpsTone;
  title: string;
  detail: string;
};

export type CashflowOpsTimelineItem = CashflowOpsItem & {
  timeLabel?: string;
  source: 'record' | 'computed' | 'system';
  sourceLabel: string;
  fieldLabel?: string;
};

export type CashflowOpsSummary = {
  status: {
    kind: 'ready' | 'review' | 'blocked';
    label: string;
    detail: string;
    tone: CashflowOpsTone;
  };
  rates: {
    projection: { done: number; total: number; percent: number; missingLabels: string[] };
    actual: { done: number; total: number; percent: number; missingLabels: string[] };
    closed: { done: number; total: number; percent: number; missingLabels: string[] };
  };
  inbox: CashflowOpsItem[];
  timeline: CashflowOpsTimelineItem[];
  timelineCounts: {
    record: number;
    computed: number;
    system: number;
  };
};

function percent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function fmt(n: number): string {
  return Math.trunc(n).toLocaleString('ko-KR');
}

function formatTimeLabel(value?: string): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul',
  }).format(new Date(timestamp));
}

function isDueWeek(week: CashflowOpsWeek, asOfDate: string): boolean {
  const cutoff = String(asOfDate || '').slice(0, 10);
  if (!cutoff) return true;
  const weekStart = String(week.weekStart || '').slice(0, 10);
  const weekEnd = String(week.weekEnd || '').slice(0, 10);
  if (weekStart) return weekStart <= cutoff;
  if (weekEnd) return weekEnd <= cutoff;
  return true;
}

export function buildCashflowOpsSummary(input: {
  asOfDate: string;
  weeks: CashflowOpsWeek[];
  diffCellCount: number;
  labor: {
    nextMonthProjectionWritten: boolean;
    missingProjectionMonthCount: number;
    shortageStatus: 'ok' | 'warning' | 'danger';
    shortageWeekLabel: string | null;
    shortageAmount: number;
  };
  lastEditedLabel?: string;
}): CashflowOpsSummary {
  const weeks = input.weeks;
  const dueWeeks = weeks.filter((week) => isDueWeek(week, input.asOfDate));
  const projectionDueMissing = dueWeeks.filter((week) => !week.projectionWritten);
  const actualDueMissing = dueWeeks.filter((week) => !week.actualWritten);
  const closedDueMissing = dueWeeks.filter((week) => !week.adminClosed);

  const rates = {
    projection: {
      done: dueWeeks.length - projectionDueMissing.length,
      total: dueWeeks.length,
      percent: percent(dueWeeks.length - projectionDueMissing.length, dueWeeks.length),
      missingLabels: projectionDueMissing.map((week) => week.label),
    },
    actual: {
      done: dueWeeks.length - actualDueMissing.length,
      total: dueWeeks.length,
      percent: percent(dueWeeks.length - actualDueMissing.length, dueWeeks.length),
      missingLabels: actualDueMissing.map((week) => week.label),
    },
    closed: {
      done: dueWeeks.length - closedDueMissing.length,
      total: dueWeeks.length,
      percent: percent(dueWeeks.length - closedDueMissing.length, dueWeeks.length),
      missingLabels: closedDueMissing.map((week) => week.label),
    },
  };

  const inbox: CashflowOpsItem[] = [];
  if (actualDueMissing.length > 0) {
    inbox.push({
      id: 'actual-due-missing',
      tone: 'danger',
      title: `Actual 미작성 주차 ${actualDueMissing.length}건`,
      detail: actualDueMissing.slice(0, 3).map((week) => week.label).join(', '),
    });
  }
  if (projectionDueMissing.length > 0) {
    inbox.push({
      id: 'projection-missing',
      tone: 'danger',
      title: `Projection 미작성 주차 ${projectionDueMissing.length}건`,
      detail: projectionDueMissing.slice(0, 3).map((week) => week.label).join(', '),
    });
  }
  if (input.diffCellCount > 0) {
    inbox.push({
      id: 'projection-actual-diff',
      tone: 'warning',
      title: `Projection/Actual 차이 ${input.diffCellCount}건`,
      detail: '결산 전 차이 항목 확인이 필요합니다.',
    });
  }
  if (!input.labor.nextMonthProjectionWritten) {
    inbox.push({
      id: 'next-labor-projection-missing',
      tone: 'danger',
      title: '다음 달 인건비 Projection 미작성',
      detail: '인건비 산입 여부를 확인해 주세요.',
    });
  }
  if (input.labor.shortageStatus !== 'ok') {
    inbox.push({
      id: 'balance-shortage',
      tone: input.labor.shortageStatus === 'danger' ? 'danger' : 'warning',
      title: input.labor.shortageStatus === 'danger' ? '잔액 부족 예상' : '잔액 주의',
      detail: `${input.labor.shortageWeekLabel || '예상 주차 없음'} · 필요 확인 금액 ${fmt(input.labor.shortageAmount)}원`,
    });
  }
  if (input.labor.missingProjectionMonthCount > 0 && input.labor.nextMonthProjectionWritten) {
    inbox.push({
      id: 'labor-projection-coverage',
      tone: 'warning',
      title: `인건비 Projection 미산입 월 ${input.labor.missingProjectionMonthCount}건`,
      detail: '월별 인건비 Projection 작성 여부를 확인해 주세요.',
    });
  }
  if (inbox.length === 0) {
    inbox.push({
      id: 'all-clear',
      tone: 'success',
      title: '확인할 항목이 없습니다',
      detail: '현재 기준 결산 차단 항목이 없습니다.',
    });
  }

  const timeline: CashflowOpsTimelineItem[] = [];
  if (input.lastEditedLabel) {
    timeline.push({
      id: 'last-edited',
      tone: 'info',
      title: '마지막 수정',
      detail: input.lastEditedLabel,
      source: 'record',
      sourceLabel: '기록',
      fieldLabel: 'cashflowEditLocks.lastEditedAt',
    });
  }
  for (const week of weeks) {
    if (week.adminClosedAt) {
      timeline.push({
        id: `${week.key}-closed`,
        tone: 'success',
        title: `${week.label} 결산 완료`,
        detail: week.adminClosedByName ? `${week.adminClosedByName} 처리` : '결산 완료',
        timeLabel: formatTimeLabel(week.adminClosedAt),
        source: 'record',
        sourceLabel: '기록',
        fieldLabel: 'cashflow_weeks.adminClosedAt',
      });
    } else if (week.pmSubmittedAt) {
      timeline.push({
        id: `${week.key}-actual`,
        tone: 'info',
        title: `${week.label} Actual 작성`,
        detail: week.pmSubmittedByName ? `${week.pmSubmittedByName} 제출` : 'Actual 작성',
        timeLabel: formatTimeLabel(week.pmSubmittedAt),
        source: 'record',
        sourceLabel: '기록',
        fieldLabel: 'cashflow_weeks.pmSubmittedAt',
      });
    } else if (week.projectionUpdatedAt) {
      timeline.push({
        id: `${week.key}-projection`,
        tone: 'info',
        title: `${week.label} Projection 작성`,
        detail: week.projectionUpdatedByName ? `${week.projectionUpdatedByName} 저장` : 'Projection 작성',
        timeLabel: formatTimeLabel(week.projectionUpdatedAt),
        source: 'record',
        sourceLabel: '기록',
        fieldLabel: 'cashflow_weeks.projectionUpdatedAt',
      });
    } else if (week.updatedAt) {
      timeline.push({
        id: `${week.key}-updated`,
        tone: 'neutral',
        title: `${week.label} 값 변경`,
        detail: week.updatedByName ? `${week.updatedByName} 수정` : '값 변경',
        timeLabel: formatTimeLabel(week.updatedAt),
        source: 'record',
        sourceLabel: '기록',
        fieldLabel: 'cashflow_weeks.updatedAt',
      });
    }
  }
  if (input.diffCellCount > 0) {
    timeline.unshift({
      id: 'diff-detected',
      tone: 'warning',
      title: '차이 확인 필요',
      detail: `Projection/Actual 차이 셀 ${input.diffCellCount}건`,
      source: 'computed',
      sourceLabel: '계산',
      fieldLabel: 'Actual - Projection',
    });
  }
  if (input.labor.shortageStatus !== 'ok') {
    timeline.unshift({
      id: 'shortage-detected',
      tone: input.labor.shortageStatus === 'danger' ? 'danger' : 'warning',
      title: '잔액 부족 예상',
      detail: `${input.labor.shortageWeekLabel || '예상 주차 없음'} · ${fmt(input.labor.shortageAmount)}원 확인`,
      source: 'computed',
      sourceLabel: '계산',
      fieldLabel: 'labor-risk BFF',
    });
  }
  if (timeline.length === 0) {
    timeline.push({
      id: 'no-events',
      tone: 'neutral',
      title: '운영 로그 대기',
      detail: '저장, 결산, 연동 기록이 생기면 여기에 표시됩니다.',
      source: 'system',
      sourceLabel: '시스템',
      fieldLabel: 'empty-state',
    });
  }

  const blockerCount = actualDueMissing.length + projectionDueMissing.length + (input.labor.shortageStatus === 'danger' ? 1 : 0);
  const reviewCount = input.diffCellCount + (input.labor.nextMonthProjectionWritten ? 0 : 1) + input.labor.missingProjectionMonthCount + (input.labor.shortageStatus === 'warning' ? 1 : 0);
  const status = blockerCount > 0
    ? {
        kind: 'blocked' as const,
        label: '결산 불가',
        detail: `이번 주 기준 ${blockerCount.toLocaleString('ko-KR')}개 확인 항목이 있습니다.`,
        tone: 'danger' as const,
      }
    : reviewCount > 0
      ? {
          kind: 'review' as const,
          label: '확인 필요',
          detail: `${reviewCount.toLocaleString('ko-KR')}개 확인 항목이 있습니다.`,
          tone: 'warning' as const,
        }
      : {
          kind: 'ready' as const,
          label: '결산 가능',
          detail: '이번 주 기준 결산 불가 항목이 없습니다.',
          tone: 'success' as const,
        };

  const visibleTimeline = timeline.slice(0, 12);
  const timelineCounts = visibleTimeline.reduce<CashflowOpsSummary['timelineCounts']>((acc, item) => {
    acc[item.source] += 1;
    return acc;
  }, { record: 0, computed: 0, system: 0 });

  return {
    status,
    rates,
    inbox,
    timeline: visibleTimeline,
    timelineCounts,
  };
}
