import { asyncHandler, assertActorRoleAllowed, createHttpError, readOptionalText, ROUTE_ROLES } from '../bff-utils.mjs';
import {
  resolvePortalEntryMemberAccess,
  resolvePortalEntryRegistrationState,
  selectPortalEntryProjects,
} from './portal-entry.mjs';
import { addDays, addMonthsToYearMonth, getSeoulTodayIso } from '../payroll-worker.mjs';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function formatIsoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + Number(deltaDays) * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function dayOfWeekUtc(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function daysInMonthUtc(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function startOfWeekWednesday(isoDate) {
  const [yRaw, mRaw, dRaw] = String(isoDate || '').split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const dow = dayOfWeekUtc(year, month, day);
  const delta = -((dow - 3 + 7) % 7);
  return addDaysUtc(isoDate, delta);
}

function countDaysInMonthForWeek(weekStart, year, month) {
  let count = 0;
  for (let i = 0; i < 7; i += 1) {
    const date = addDaysUtc(weekStart, i);
    const [yy, mm] = date.split('-');
    if (Number.parseInt(yy, 10) === year && Number.parseInt(mm, 10) === month) count += 1;
  }
  return count;
}

function getMonthMondayWeeks(yearMonth) {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) return [];

  const { year, month } = parsed;
  const firstDay = formatIsoDate(year, month, 1);
  const lastDay = formatIsoDate(year, month, daysInMonthUtc(year, month));
  let weekStart = startOfWeekWednesday(firstDay);
  const weeks = [];
  const yy = year % 100;
  let weekNo = 0;

  while (weekStart <= lastDay) {
    const daysInMonth = countDaysInMonthForWeek(weekStart, year, month);
    if (daysInMonth >= 4) {
      weekNo += 1;
      const weekEnd = addDaysUtc(weekStart, 6);
      const label = `${yy}-${month}-${weekNo}`;
      weeks.push({ yearMonth, weekNo, weekStart, weekEnd, label });
    }
    weekStart = addDaysUtc(weekStart, 7);
  }

  return weeks;
}

function resolveCurrentCashflowWeek(todayIso) {
  const yearMonth = typeof todayIso === 'string' ? todayIso.slice(0, 7) : '';
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return undefined;
  return getMonthMondayWeeks(yearMonth).find((week) => todayIso >= week.weekStart && todayIso <= week.weekEnd);
}

function normalizeProjectSummary(project) {
  const value = project && typeof project === 'object' ? project : {};
  const id = readOptionalText(value.id);
  return {
    id,
    name: readOptionalText(value.name) || id,
    shortName: readOptionalText(value.shortName) || undefined,
    managerName: readOptionalText(value.managerName) || undefined,
    clientOrg: readOptionalText(value.clientOrg) || undefined,
    department: readOptionalText(value.department) || undefined,
    status: readOptionalText(value.status) || undefined,
    type: readOptionalText(value.type) || undefined,
    settlementType: readOptionalText(value.settlementType) || undefined,
    basis: readOptionalText(value.basis) || undefined,
    contractAmount: Number.isFinite(Number(value.contractAmount)) ? Number(value.contractAmount) : undefined,
  };
}

function normalizeWeeklySubmissionStatus(status) {
  const value = status && typeof status === 'object' ? status : {};
  return {
    projectId: readOptionalText(value.projectId),
    yearMonth: readOptionalText(value.yearMonth),
    weekNo: Number.isFinite(Number(value.weekNo)) ? Number(value.weekNo) : 0,
    projectionEdited: Boolean(value.projectionEdited),
    projectionUpdated: Boolean(value.projectionUpdated),
    expenseEdited: Boolean(value.expenseEdited),
    expenseUpdated: Boolean(value.expenseUpdated),
    expenseReviewPendingCount: Number.isFinite(Number(value.expenseReviewPendingCount))
      ? Math.max(0, Number(value.expenseReviewPendingCount))
      : 0,
    projectionEditedAt: readOptionalText(value.projectionEditedAt) || undefined,
    projectionUpdatedAt: readOptionalText(value.projectionUpdatedAt) || undefined,
    expenseUpdatedAt: readOptionalText(value.expenseUpdatedAt) || undefined,
    updatedAt: readOptionalText(value.updatedAt) || undefined,
  };
}

function buildWeeklyAccountingSnapshot(status) {
  return {
    projectionEdited: Boolean(status?.projectionEdited),
    projectionDone: Boolean(status?.projectionUpdated),
    expenseEdited: Boolean(status?.expenseEdited),
    expenseDone: Boolean(status?.expenseUpdated),
    expenseSyncState: status?.expenseReviewPendingCount > 0 ? 'review_required' : (status?.expenseUpdated ? 'synced' : 'pending'),
    expenseReviewPendingCount: Number.isFinite(status?.expenseReviewPendingCount) ? status.expenseReviewPendingCount : 0,
    pmSubmitted: Boolean(status?.projectionUpdated && status?.expenseUpdated),
    adminClosed: Boolean(status?.expenseUpdated),
  };
}

function resolveWeeklyAccountingProductStatus(snapshot) {
  const reviewCount = Math.max(0, Number(snapshot?.expenseReviewPendingCount) || 0);
  const syncState = snapshot?.expenseSyncState || 'idle';
  const saveState = snapshot?.expenseDone ? 'saved' : 'dirty';
  const expenseDone = Boolean(snapshot?.expenseDone) || saveState === 'saved' || syncState === 'synced' || syncState === 'review_required' || syncState === 'sync_failed';

  if (saveState === 'dirty' || saveState === 'saving' || (!expenseDone && saveState !== 'saved')) {
    return {
      kind: 'save_pending',
      label: '저장 전 초안',
      description: '현재 편집 내용은 아직 주간 정산 기준본으로 확정되지 않았습니다.',
      tone: 'warning',
      auditTitle: '최종 저장 대기 반영',
    };
  }

  if (syncState === 'review_required') {
    return {
      kind: 'review_required',
      label: reviewCount > 0 ? `사람 확인 ${reviewCount}건` : '사람 확인 필요',
      description: '일부 행은 자동 분류가 끝나지 않았습니다. 증빙을 확인한 뒤 사람 확인을 마쳐야 최종 반영됩니다.',
      tone: 'warning',
      auditTitle: '최종 사람 확인 상태 반영',
    };
  }

  if (syncState === 'synced') {
    return {
      kind: 'save_synced',
      label: '동기화 완료',
      description: '주간 정산 기준본이 실제값 반영까지 끝났습니다.',
      tone: 'success',
      auditTitle: '최종 동기화 반영',
    };
  }

  if (syncState === 'sync_failed') {
    return {
      kind: 'sync_failed',
      label: '동기화 실패',
      description: '정산대장은 저장되었지만 실제값 반영이 끝나지 않았습니다.',
      tone: 'danger',
      auditTitle: '최종 동기화 실패 반영',
    };
  }

  return {
    kind: 'save_pending',
    label: '저장 전 초안',
    description: '현재 편집 내용은 아직 주간 정산 기준본으로 확정되지 않았습니다.',
    tone: 'warning',
    auditTitle: '최종 저장 대기 반영',
  };
}

function resolvePortalAccountingStatus(status, currentWeek, latestProjectionUpdatedAt) {
  const snapshot = buildWeeklyAccountingSnapshot(status);
  const productStatus = resolveWeeklyAccountingProductStatus(snapshot);
  return {
    currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
    projection: {
      label: snapshot.projectionEdited ? '작성됨' : '미작성',
      detail: currentWeek
        ? `${currentWeek.weekNo}주차 · ${snapshot.projectionDone ? '제출 완료' : '미제출'}`
        : '이번 주 주차를 찾지 못했습니다.',
      latestUpdatedAt: latestProjectionUpdatedAt,
    },
    expense: {
      label: productStatus.label,
      detail: currentWeek
        ? `${currentWeek.weekNo}주차 · ${productStatus.description}`
        : productStatus.description,
      tone: productStatus.tone,
    },
  };
}

function findLatestProjectionUpdatedAt(statuses) {
  return (Array.isArray(statuses) ? statuses : [])
    .map((status) => normalizeWeeklySubmissionStatus(status).projectionUpdatedAt)
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0];
}

function resolvePayrollLiquidityStatus({
  today,
  activeRun,
  expectedPayrollAmount,
  dayBalances,
}) {
  const knownBalances = dayBalances
    .map((entry) => entry.balance)
    .filter((value) => typeof value === 'number');
  const currentBalance = findBalanceForDay(dayBalances, today);
  const worstBalance = knownBalances.length ? Math.min(...knownBalances) : null;
  const insufficient = expectedPayrollAmount !== null
    && knownBalances.some((balance) => balance < expectedPayrollAmount);
  const paymentUnconfirmed = today >= activeRun.plannedPayDate && activeRun.paidStatus !== 'CONFIRMED';

  if (insufficient) {
    return {
      status: 'insufficient_balance',
      statusReason: 'D-3~D+3 구간에 예상 인건비보다 잔액이 낮습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (paymentUnconfirmed) {
    return {
      status: 'payment_unconfirmed',
      statusReason: '지급일이 지났지만 아직 지급 확정이 기록되지 않았습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (expectedPayrollAmount === null) {
    return {
      status: 'baseline_missing',
      statusReason: '직전 확정 지급액이 없어 예상 인건비 기준선을 만들 수 없습니다.',
      worstBalance,
      currentBalance,
    };
  }
  if (knownBalances.length === 0) {
    return {
      status: 'balance_unknown',
      statusReason: '잔액 데이터가 없어 지급 여력을 계산할 수 없습니다.',
      worstBalance,
      currentBalance,
    };
  }
  return {
    status: 'clear',
    statusReason: '지급 창에서 잔액과 지급 상태가 안정적입니다.',
    worstBalance,
    currentBalance,
  };
}

function findBalanceForDay(dayBalances, today) {
  const sameDay = dayBalances.find((entry) => entry.date === today);
  if (sameDay) return sameDay.balance;
  const eligible = dayBalances
    .filter((entry) => entry.date <= today && typeof entry.balance === 'number')
    .sort((a, b) => b.date.localeCompare(a.date));
  return eligible[0]?.balance ?? null;
}

function txAmount(tx) {
  const expense = Number.isFinite(tx.amounts?.expenseAmount) ? tx.amounts.expenseAmount : 0;
  const bank = Number.isFinite(tx.amounts?.bankAmount) ? tx.amounts.bankAmount : 0;
  return Math.max(expense, bank, 0);
}

function findLatestBalanceOnOrBefore(transactions, day) {
  let latest = null;
  for (const tx of transactions) {
    const txDay = String(tx.dateTime || '').slice(0, 10);
    if (txDay > day) continue;
    if (!latest || tx.dateTime > latest.dateTime) latest = tx;
  }
  return latest ? latest.amounts.balanceAfter : null;
}

function buildDayWindow(plannedPayDate) {
  return Array.from({ length: 7 }, (_, index) => addDays(plannedPayDate, index - 3));
}

function findBaselineRun(projectRuns, activeRun) {
  const confirmed = projectRuns
    .filter((run) => run.id !== activeRun.id && run.paidStatus === 'CONFIRMED' && run.plannedPayDate < activeRun.plannedPayDate)
    .sort((a, b) => b.plannedPayDate.localeCompare(a.plannedPayDate));
  return confirmed[0] || null;
}

function computeExpectedPayrollAmount(baselineRun, transactions) {
  if (!baselineRun?.matchedTxIds?.length) return null;
  const matchedIds = new Set(baselineRun.matchedTxIds);
  const amount = transactions
    .filter((tx) => matchedIds.has(tx.id))
    .reduce((sum, tx) => sum + txAmount(tx), 0);
  return amount > 0 ? amount : null;
}

function resolveProjectPayrollLiquidity({ project, runs, transactions, today }) {
  const projectRuns = runs
    .filter((run) => run.projectId === project.id)
    .sort((a, b) => a.plannedPayDate.localeCompare(b.plannedPayDate));
  const activeRuns = projectRuns.filter((run) => {
    const windowStart = addDays(run.plannedPayDate, -3);
    const windowEnd = addDays(run.plannedPayDate, 3);
    return today >= windowStart && today <= windowEnd;
  });
  const approvedTransactions = transactions
    .filter((tx) => tx.projectId === project.id && tx.state === 'APPROVED' && typeof tx.amounts?.balanceAfter === 'number')
    .sort((a, b) => a.dateTime.localeCompare(b.dateTime));

  return activeRuns
    .map((activeRun) => {
      const baselineRun = findBaselineRun(projectRuns, activeRun);
      const expectedPayrollAmount = computeExpectedPayrollAmount(baselineRun, approvedTransactions);
      const dayBalances = buildDayWindow(activeRun.plannedPayDate).map((day) => ({
        date: day,
        balance: findLatestBalanceOnOrBefore(approvedTransactions, day),
      }));
      const { status, statusReason, worstBalance, currentBalance } = resolvePayrollLiquidityStatus({
        today,
        activeRun,
        expectedPayrollAmount,
        dayBalances,
      });
      return {
        projectId: project.id,
        projectName: project.name,
        projectShortName: project.shortName || project.id,
        runId: activeRun.id,
        yearMonth: activeRun.yearMonth,
        plannedPayDate: activeRun.plannedPayDate,
        windowStart: dayBalances[0]?.date || addDays(activeRun.plannedPayDate, -3),
        windowEnd: dayBalances[dayBalances.length - 1]?.date || addDays(activeRun.plannedPayDate, 3),
        expectedPayrollAmount,
        baselineRunId: baselineRun?.id || null,
        status,
        statusReason,
        dayBalances,
        worstBalance,
        currentBalance,
        paidStatus: activeRun.paidStatus,
        acknowledged: activeRun.acknowledged,
      };
    })
    .sort((a, b) => {
      const priority = {
        insufficient_balance: 0,
        payment_unconfirmed: 1,
        baseline_missing: 2,
        balance_unknown: 3,
        clear: 4,
      };
      const delta = priority[a.status] - priority[b.status];
      if (delta !== 0) return delta;
      return a.plannedPayDate.localeCompare(b.plannedPayDate);
    });
}

function normalizeBankStatementProfile(columns, fileName = '') {
  const joined = [...columns.map((col) => String(col || '').toLowerCase()), String(fileName || '').toLowerCase()].join(' ');
  if (joined.includes('hana') || joined.includes('하나') || joined.includes('keb')) return 'hana';
  if (joined.includes('kb') || joined.includes('국민')) return 'kb';
  if (joined.includes('shinhan') || joined.includes('신한')) return 'shinhan';
  return 'general';
}

function normalizeBankStatementRows(sheet) {
  const value = sheet && typeof sheet === 'object' ? sheet : {};
  const columns = Array.isArray(value.columns) ? value.columns.map((cell) => String(cell || '')) : [];
  const rows = Array.isArray(value.rows) ? value.rows : [];
  return {
    columns,
    rows,
  };
}

function normalizeExpenseSheet(sheet) {
  const value = sheet && typeof sheet === 'object' ? sheet : {};
  return {
    id: readOptionalText(value.id),
    name: readOptionalText(value.name) || readOptionalText(value.id) || '기본 탭',
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
    rows: Array.isArray(value.rows) ? value.rows : [],
    createdAt: readOptionalText(value.createdAt) || undefined,
    updatedAt: readOptionalText(value.updatedAt) || undefined,
  };
}

function chooseActiveExpenseSheet(expenseSheets) {
  if (!Array.isArray(expenseSheets) || expenseSheets.length === 0) {
    return {
      id: 'default',
      name: '기본 탭',
      rows: [],
    };
  }
  return expenseSheets.find((sheet) => sheet.id === 'default') || expenseSheets[0];
}

function formatShortAmount(value) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${(amount / 1e8).toFixed(0)}억`;
  if (abs >= 1e8) return `${(amount / 1e8).toFixed(2)}억`;
  if (abs >= 1e4) return `${Math.round(amount / 1e4).toLocaleString('ko-KR')}만`;
  return amount.toLocaleString('ko-KR');
}

function sumProjectBankAmounts(transactions, projectId, direction) {
  return (Array.isArray(transactions) ? transactions : [])
    .filter((tx) => readOptionalText(tx?.projectId) === projectId && readOptionalText(tx?.direction) === direction)
    .reduce((sum, tx) => {
      const bankAmount = Number.isFinite(Number(tx?.amounts?.bankAmount)) ? Number(tx.amounts.bankAmount) : 0;
      return sum + bankAmount;
    }, 0);
}

function buildDashboardFinanceSummaryItems({ project, transactions }) {
  const totalIn = sumProjectBankAmounts(transactions, project.id, 'IN');
  const totalOut = sumProjectBankAmounts(transactions, project.id, 'OUT');
  const balance = totalIn - totalOut;
  const contractAmount = Number.isFinite(Number(project?.contractAmount)) ? Number(project.contractAmount) : 0;
  const burnRate = contractAmount > 0 ? totalOut / contractAmount : 0;

  return [
    { label: '총 입금', value: formatShortAmount(totalIn) },
    { label: '총 출금', value: formatShortAmount(totalOut) },
    { label: '잔액', value: formatShortAmount(balance) },
    { label: '소진율', value: `${(burnRate * 100).toFixed(1)}%` },
  ];
}

function buildDashboardSubmissionRows({ projects, weeklyStatuses, currentWeek }) {
  if (!currentWeek) return [];

  const statusMap = new Map(
    (Array.isArray(weeklyStatuses) ? weeklyStatuses : []).map((status) => [
      `${status.projectId}-${status.yearMonth}-w${status.weekNo}`,
      status,
    ]),
  );

  return (Array.isArray(projects) ? projects : []).map((project) => {
    const normalizedProject = normalizeProjectSummary(project);
    const status = statusMap.get(`${normalizedProject.id}-${currentWeek.yearMonth}-w${currentWeek.weekNo}`);
    const snapshot = buildWeeklyAccountingSnapshot(status);
    const expenseStatus = resolveWeeklyAccountingProductStatus(snapshot);

    return {
      id: normalizedProject.id,
      name: normalizedProject.name,
      shortName: normalizedProject.shortName || normalizedProject.id,
      projectionInputLabel: snapshot.projectionEdited ? '입력됨' : '미입력',
      projectionDoneLabel: snapshot.projectionDone ? '제출 완료' : '미완료',
      expenseLabel: expenseStatus.label,
      expenseTone: expenseStatus.tone === 'muted' ? 'neutral' : expenseStatus.tone,
      latestProjectionUpdatedAt: status?.projectionUpdatedAt || status?.projectionEditedAt || status?.updatedAt,
    };
  });
}

function buildDashboardHrAlertPreview({ alerts, projectId }) {
  const visibleAlerts = (Array.isArray(alerts) ? alerts : [])
    .filter((alert) => readOptionalText(alert?.projectId) === projectId && !Boolean(alert?.acknowledged))
    .sort((a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));

  return {
    count: visibleAlerts.length,
    items: visibleAlerts.slice(0, 3).map((alert) => ({
      id: readOptionalText(alert?.id),
      employeeName: readOptionalText(alert?.employeeName) || '-',
      eventType: readOptionalText(alert?.eventType) || 'UNKNOWN',
      effectiveDate: readOptionalText(alert?.effectiveDate) || '',
      projectId,
    })),
    overflowCount: Math.max(0, visibleAlerts.length - 3),
  };
}

function buildDashboardNoticeSummary({ projectId, todayIso, payrollRuns, monthlyCloses, hrAlerts }) {
  const yearMonth = typeof todayIso === 'string' ? todayIso.slice(0, 7) : '';
  const previousYearMonth = /^\d{4}-\d{2}$/.test(yearMonth)
    ? addMonthsToYearMonth(yearMonth, -1)
    : '';
  const payrollRun = (Array.isArray(payrollRuns) ? payrollRuns : []).find((run) => (
    readOptionalText(run?.projectId) === projectId
    && readOptionalText(run?.yearMonth) === yearMonth
  )) || null;
  const monthlyClose = (Array.isArray(monthlyCloses) ? monthlyCloses : []).find((close) => (
    readOptionalText(close?.projectId) === projectId
    && readOptionalText(close?.yearMonth) === previousYearMonth
  )) || null;
  const hrAlertPreview = buildDashboardHrAlertPreview({
    alerts: hrAlerts,
    projectId,
  });

  return {
    payrollAck: payrollRun && todayIso >= readOptionalText(payrollRun.noticeDate) && !Boolean(payrollRun.acknowledged)
      ? {
          runId: readOptionalText(payrollRun.id),
          plannedPayDate: readOptionalText(payrollRun.plannedPayDate),
          noticeDate: readOptionalText(payrollRun.noticeDate),
        }
      : null,
    monthlyCloseAck: monthlyClose && readOptionalText(monthlyClose.status) === 'DONE' && !Boolean(monthlyClose.acknowledged)
      ? {
          closeId: readOptionalText(monthlyClose.id),
          yearMonth: readOptionalText(monthlyClose.yearMonth),
          doneAt: readOptionalText(monthlyClose.doneAt) || undefined,
        }
      : null,
    hrAlerts: hrAlertPreview,
  };
}

export function buildPortalDashboardSummary(input) {
  const project = normalizeProjectSummary(input.project);
  const currentWeek = resolveCurrentCashflowWeek(input.todayIso || getSeoulTodayIso());
  const weeklyStatuses = Array.isArray(input.weeklySubmissionStatuses)
    ? input.weeklySubmissionStatuses.map((status) => normalizeWeeklySubmissionStatus(status))
    : [];
  const projectStatuses = weeklyStatuses.filter((status) => status.projectId === project.id);
  const currentStatus = currentWeek
    ? projectStatuses.find((status) => status.yearMonth === currentWeek.yearMonth && status.weekNo === currentWeek.weekNo)
    : undefined;
  const latestProjectionUpdatedAt = readOptionalText(input.projectionLatestUpdatedAt)
    || findLatestProjectionUpdatedAt(input.projectWeeklySubmissionStatuses)
    || findLatestProjectionUpdatedAt(projectStatuses);
  const accountingStatus = resolvePortalAccountingStatus(currentStatus, currentWeek, latestProjectionUpdatedAt);
  const payrollRiskCount = Math.max(0, Number(input.payrollRiskCount) || 0);
  const hrAlertCount = Math.max(0, Number(input.hrAlertCount) || 0);
  const visibleProjects = Math.max(0, Number(input.visibleProjects) || 0);
  const orderedProjects = [
    project,
    ...(Array.isArray(input.projects) ? input.projects : [])
      .map((entry) => normalizeProjectSummary(entry))
      .filter((entry) => entry.id && entry.id !== project.id),
  ];
  const visibleIssues = [
    {
      label: '미확인 공지',
      count: hrAlertCount,
      tone: 'warn',
      to: '/portal/change-requests',
    },
    {
      label: '인건비 Queue',
      count: payrollRiskCount,
      tone: 'danger',
      to: '/portal/payroll',
    },
  ].filter((item) => item.count > 0);
  const payrollQueue = resolveProjectPayrollLiquidity({
    project,
    runs: Array.isArray(input.payrollRuns) ? input.payrollRuns : [],
    transactions: Array.isArray(input.transactions) ? input.transactions : [],
    today: input.todayIso || getSeoulTodayIso(),
  });

  return {
    project,
    summary: {
      payrollRiskCount,
      visibleProjects,
      hrAlertCount,
      currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
    },
    currentWeek: currentWeek
      ? {
          label: currentWeek.label,
          weekStart: currentWeek.weekStart,
          weekEnd: currentWeek.weekEnd,
          yearMonth: currentWeek.yearMonth,
          weekNo: currentWeek.weekNo,
        }
      : null,
    surface: {
      ...accountingStatus,
      visibleIssues,
    },
    financeSummaryItems: buildDashboardFinanceSummaryItems({
      project: input.project && typeof input.project === 'object'
        ? { ...(input.project || {}), id: project.id }
        : project,
      transactions: input.transactions,
    }),
    submissionRows: buildDashboardSubmissionRows({
      projects: orderedProjects,
      weeklyStatuses,
      currentWeek,
    }),
    notices: buildDashboardNoticeSummary({
      projectId: project.id,
      todayIso: input.todayIso || getSeoulTodayIso(),
      payrollRuns: input.payrollRuns,
      monthlyCloses: input.monthlyCloses,
      hrAlerts: input.hrAlerts,
    }),
    payrollQueue: {
      item: payrollQueue[0] || null,
      riskItems: payrollQueue.filter((item) => item.status === 'insufficient_balance' || item.status === 'payment_unconfirmed'),
    },
  };
}

export function buildPortalPayrollSummary(input) {
  const project = normalizeProjectSummary(input.project);
  const schedule = input.payrollSchedule && typeof input.payrollSchedule === 'object'
    ? {
        id: readOptionalText(input.payrollSchedule.id) || project.id,
        projectId: readOptionalText(input.payrollSchedule.projectId) || project.id,
        dayOfMonth: Number.isFinite(Number(input.payrollSchedule.dayOfMonth)) ? Number(input.payrollSchedule.dayOfMonth) : 0,
        timezone: readOptionalText(input.payrollSchedule.timezone) || 'Asia/Seoul',
        noticeLeadBusinessDays: Number.isFinite(Number(input.payrollSchedule.noticeLeadBusinessDays))
          ? Number(input.payrollSchedule.noticeLeadBusinessDays)
          : 3,
        active: input.payrollSchedule.active !== false,
      }
    : {
        id: project.id,
        projectId: project.id,
        dayOfMonth: 25,
        timezone: 'Asia/Seoul',
        noticeLeadBusinessDays: 3,
        active: false,
      };
  const today = input.todayIso || getSeoulTodayIso();
  const runs = Array.isArray(input.payrollRuns) ? input.payrollRuns : [];
  const transactions = Array.isArray(input.transactions) ? input.transactions : [];
  const queue = resolveProjectPayrollLiquidity({ project, runs, transactions, today });
  const currentRun = queue[0] || null;

  return {
    project,
    schedule,
    currentRun,
    summary: {
      queueCount: queue.length,
      riskCount: queue.filter((item) => item.status === 'insufficient_balance' || item.status === 'payment_unconfirmed').length,
      status: currentRun?.status || 'clear',
      statusReason: currentRun?.statusReason || '지급 창에서 잔액과 지급 상태가 안정적입니다.',
    },
    queue,
  };
}

export function buildPortalWeeklyExpensesSummary(input) {
  const project = normalizeProjectSummary(input.project);
  const todayIso = input.todayIso || getSeoulTodayIso();
  const currentWeek = resolveCurrentCashflowWeek(todayIso);
  const weeklyStatuses = Array.isArray(input.weeklySubmissionStatuses)
    ? input.weeklySubmissionStatuses.map((status) => normalizeWeeklySubmissionStatus(status))
    : [];
  const projectStatuses = weeklyStatuses.filter((status) => status.projectId === project.id);
  const currentStatus = currentWeek
    ? projectStatuses.find((status) => status.yearMonth === currentWeek.yearMonth && status.weekNo === currentWeek.weekNo)
    : undefined;
  const expenseSheets = Array.isArray(input.expenseSheets) ? input.expenseSheets.map((sheet) => normalizeExpenseSheet(sheet)) : [];
  const activeExpenseSheet = chooseActiveExpenseSheet(expenseSheets);
  const bankStatementRows = normalizeBankStatementRows(input.bankStatementRows);
  const sheetSources = Array.isArray(input.sheetSources) ? input.sheetSources : [];
  const bankStatementProfile = normalizeBankStatementProfile(bankStatementRows.columns, input.bankStatementFileName || '');

  return {
    project,
    summary: {
      currentWeekLabel: currentWeek ? `${currentWeek.weekNo}주차` : '-',
      expenseReviewPendingCount: Number(currentStatus?.expenseReviewPendingCount) || 0,
    },
    expenseSheet: {
      activeSheetId: activeExpenseSheet.id,
      activeSheetName: activeExpenseSheet.name,
      sheetCount: expenseSheets.length || (activeExpenseSheet.rows ? 1 : 0),
      rowCount: Array.isArray(activeExpenseSheet.rows) ? activeExpenseSheet.rows.length : 0,
    },
    bankStatement: {
      rowCount: bankStatementRows.rows.length,
      columnCount: bankStatementRows.columns.length,
      profile: bankStatementProfile,
      lastSavedAt: readOptionalText(input.bankStatementLastSavedAt) || undefined,
    },
    sheetSources: sheetSources.map((source) => ({
      sourceType: readOptionalText(source?.sourceType) || 'unknown',
      sheetName: readOptionalText(source?.sheetName) || '',
      fileName: readOptionalText(source?.fileName) || '',
      rowCount: Number.isFinite(Number(source?.rowCount)) ? Number(source.rowCount) : 0,
      columnCount: Number.isFinite(Number(source?.columnCount)) ? Number(source.columnCount) : 0,
      uploadedAt: readOptionalText(source?.uploadedAt) || undefined,
    })),
    handoff: {
      canOpenWeeklyExpenses: Boolean(project.id) && (expenseSheets.length > 0 || bankStatementRows.rows.length > 0),
      canUseEvidenceWorkflow: sheetSources.some((source) => readOptionalText(source?.sourceType) === 'evidence_rules'),
      nextPath: '/portal/bank-statements',
    },
  };
}

export function buildPortalBankStatementsSummary(input) {
  const project = normalizeProjectSummary(input.project);
  const expenseSheets = Array.isArray(input.expenseSheets) ? input.expenseSheets.map((sheet) => normalizeExpenseSheet(sheet)) : [];
  const activeExpenseSheetId = readOptionalText(input.activeExpenseSheetId) || chooseActiveExpenseSheet(expenseSheets).id;
  const activeExpenseSheet = expenseSheets.find((sheet) => sheet.id === activeExpenseSheetId) || chooseActiveExpenseSheet(expenseSheets);
  const bankStatementRows = normalizeBankStatementRows(input.bankStatementRows);
  const bankStatementProfile = normalizeBankStatementProfile(bankStatementRows.columns, input.bankStatementFileName || '');
  const ready = bankStatementRows.rows.length > 0 || bankStatementRows.columns.length > 0;

  return {
    project,
    bankStatement: {
      rowCount: bankStatementRows.rows.length,
      columnCount: bankStatementRows.columns.length,
      profile: bankStatementProfile,
      lastSavedAt: readOptionalText(input.bankStatementLastSavedAt) || undefined,
    },
    handoffContext: {
      ready,
      reason: ready
        ? '저장된 통장내역이 있습니다.'
        : '통장내역을 먼저 저장하면 주간 사업비 화면으로 이어갈 수 있습니다.',
      nextPath: '/portal/weekly-expenses',
      activeExpenseSheetId,
      activeExpenseSheetName: activeExpenseSheet.name,
      sheetCount: expenseSheets.length || (activeExpenseSheet.rows ? 1 : 0),
    },
  };
}

async function fetchVisibleProjects(db, tenantId, role, actorId, memberProjectIds) {
  const snapshot = await db.collection(`orgs/${tenantId}/projects`).get();
  const projects = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
  return selectPortalEntryProjects({
    role,
    actorId,
    memberProjectIds,
    projects,
  });
}

async function resolvePortalReadModelContext(db, tenantId, actorId, actorRole) {
  const memberSnapshot = await db.doc(`orgs/${tenantId}/members/${actorId}`).get();
  const member = memberSnapshot.exists ? (memberSnapshot.data() || {}) : null;
  const memberAccess = resolvePortalEntryMemberAccess(member);
  const role = readOptionalText(member?.role) || actorRole || 'pm';
  const selectedProjects = await fetchVisibleProjects(db, tenantId, role, actorId, memberAccess.projectIds);
  const projectMap = new Map(selectedProjects.projects.map((project) => [project.id, project]));
  const activeProjectId = projectMap.has(memberAccess.activeProjectId)
    ? memberAccess.activeProjectId
    : selectedProjects.projects[0]?.id || '';
  const activeProject = activeProjectId ? projectMap.get(activeProjectId) || null : null;

  return {
    memberSnapshot,
    member,
    memberAccess,
    role,
    selectedProjects,
    activeProjectId,
    activeProject,
  };
}

async function loadWeeklySubmissionStatuses(db, tenantId, projectId) {
  const snap = await db.collection(`orgs/${tenantId}/weekly_submission_status`).where('projectId', '==', projectId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function loadPayrollData(db, tenantId, projectId) {
  const [scheduleSnap, runsSnap, txSnap, closeSnap] = await Promise.all([
    db.doc(`orgs/${tenantId}/payroll_schedules/${projectId}`).get(),
    db.collection(`orgs/${tenantId}/payroll_runs`).where('projectId', '==', projectId).get(),
    db.collection(`orgs/${tenantId}/transactions`).where('projectId', '==', projectId).get(),
    db.collection(`orgs/${tenantId}/monthly_closes`).where('projectId', '==', projectId).get(),
  ]);

  return {
    payrollSchedule: scheduleSnap.exists ? { id: scheduleSnap.id, ...(scheduleSnap.data() || {}) } : null,
    payrollRuns: runsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    transactions: txSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    monthlyCloses: closeSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
  };
}

async function loadWeeklyExpenseData(db, tenantId, projectId) {
  const [statuses, expenseSheetSnap, bankStatementSnap, sheetSourcesSnap] = await Promise.all([
    loadWeeklySubmissionStatuses(db, tenantId, projectId),
    db.collection(`orgs/${tenantId}/projects/${projectId}/expense_sheets`).get(),
    db.doc(`orgs/${tenantId}/projects/${projectId}/bank_statements/default`).get(),
    db.collection(`orgs/${tenantId}/projects/${projectId}/sheet_sources`).get(),
  ]);

  return {
    weeklySubmissionStatuses: statuses,
    expenseSheets: expenseSheetSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    bankStatementRows: bankStatementSnap.exists ? { id: bankStatementSnap.id, ...(bankStatementSnap.data() || {}) } : null,
    sheetSources: sheetSourcesSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })),
    bankStatementLastSavedAt: bankStatementSnap.exists ? bankStatementSnap.data()?.updatedAt : undefined,
  };
}

async function loadWeeklySubmissionStatusesForProjects(db, tenantId, projectIds, currentWeek) {
  const uniqueProjectIds = Array.from(new Set((Array.isArray(projectIds) ? projectIds : []).filter(Boolean)));
  if (!uniqueProjectIds.length || !currentWeek) return [];

  const statusSnap = await db.collection(`orgs/${tenantId}/weekly_submission_status`)
    .where('yearMonth', '==', currentWeek.yearMonth)
    .where('weekNo', '==', currentWeek.weekNo)
    .get();
  const visibleProjectIds = new Set(uniqueProjectIds);
  return statusSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((status) => visibleProjectIds.has(readOptionalText(status?.projectId)));
}

export function mountPortalReadModelRoutes(app, { db }) {
  app.get('/api/v1/portal/dashboard-summary', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read portal dashboard summary');
    const { tenantId, actorId, actorRole } = req.context;
    const { memberSnapshot, member, memberAccess, role, selectedProjects, activeProjectId, activeProject } = await resolvePortalReadModelContext(
      db,
      tenantId,
      actorId,
      actorRole,
    );
    const requestedProjectId = readOptionalText(req.query?.projectId);
    const visibleProjectMap = new Map(selectedProjects.projects.map((project) => [project.id, project]));
    if (requestedProjectId && !visibleProjectMap.has(requestedProjectId)) {
      throw createHttpError(403, '선택 가능한 사업이 아닙니다.', 'project_forbidden');
    }

    const targetProjectId = requestedProjectId || activeProjectId;
    const targetProjectFallback = (targetProjectId ? visibleProjectMap.get(targetProjectId) : null) || activeProject || null;
    const activeProjectDoc = targetProjectId
      ? await db.doc(`orgs/${tenantId}/projects/${targetProjectId}`).get()
      : null;
    const currentProject = activeProjectDoc?.exists
      ? { id: activeProjectDoc.id, ...(activeProjectDoc.data() || {}) }
      : targetProjectFallback;
    if (!currentProject) {
      throw createHttpError(
        404,
        requestedProjectId ? '선택한 사업을 찾을 수 없습니다.' : '활성 사업을 찾을 수 없습니다.',
        'project_not_found',
      );
    }

    const todayIso = getSeoulTodayIso();
    const dashboardProjectIds = Array.from(new Set([
      currentProject.id,
      ...selectedProjects.projects.map((project) => project.id).filter(Boolean),
    ]));
    const currentWeek = resolveCurrentCashflowWeek(todayIso);
    const [weeklyStatuses, currentProjectWeeklyStatuses, payrollData, hrAlertsSnap] = await Promise.all([
      loadWeeklySubmissionStatusesForProjects(db, tenantId, dashboardProjectIds, currentWeek),
      loadWeeklySubmissionStatuses(db, tenantId, currentProject.id),
      loadPayrollData(db, tenantId, currentProject.id),
      db.collection(`orgs/${tenantId}/project_change_alerts`).where('projectId', '==', currentProject.id).get(),
    ]);
    const hrAlerts = hrAlertsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
    const hrAlertCount = buildDashboardHrAlertPreview({
      alerts: hrAlerts,
      projectId: currentProject.id,
    }).count;
    const dashboard = buildPortalDashboardSummary({
      project: currentProject,
      projects: selectedProjects.projects,
      todayIso,
      transactions: payrollData.transactions,
      payrollRuns: payrollData.payrollRuns,
      monthlyCloses: payrollData.monthlyCloses,
      hrAlerts,
      projectWeeklySubmissionStatuses: currentProjectWeeklyStatuses,
      projectionLatestUpdatedAt: findLatestProjectionUpdatedAt(currentProjectWeeklyStatuses),
      weeklySubmissionStatuses: weeklyStatuses,
      payrollRiskCount: resolveProjectPayrollLiquidity({
        project: normalizeProjectSummary(currentProject),
        runs: payrollData.payrollRuns,
        transactions: payrollData.transactions,
        today: todayIso,
      }).filter((item) => item.status === 'insufficient_balance' || item.status === 'payment_unconfirmed').length,
      visibleProjects: selectedProjects.projects.length,
      hrAlertCount,
    });

    res.status(200).json({
      ...dashboard,
      registrationState: resolvePortalEntryRegistrationState({
        role,
        memberExists: memberSnapshot.exists,
        projectIds: memberAccess.projectIds,
      }),
    });
  }));

  app.get('/api/v1/portal/payroll-summary', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read portal payroll summary');
    const { tenantId, actorId, actorRole } = req.context;
    const { memberSnapshot, member, memberAccess, role, activeProjectId, activeProject } = await resolvePortalReadModelContext(
      db,
      tenantId,
      actorId,
      actorRole,
    );
    const activeProjectDoc = activeProjectId
      ? await db.doc(`orgs/${tenantId}/projects/${activeProjectId}`).get()
      : null;
    const currentProject = activeProjectDoc?.exists
      ? { id: activeProjectDoc.id, ...(activeProjectDoc.data() || {}) }
      : activeProject || null;
    if (!currentProject) {
      throw createHttpError(404, '활성 사업을 찾을 수 없습니다.', 'project_not_found');
    }

    const payrollData = await loadPayrollData(db, tenantId, currentProject.id);
    const summary = buildPortalPayrollSummary({
      project: currentProject,
      payrollSchedule: payrollData.payrollSchedule,
      payrollRuns: payrollData.payrollRuns,
      transactions: payrollData.transactions,
      todayIso: getSeoulTodayIso(),
    });

    res.status(200).json({
      ...summary,
      registrationState: resolvePortalEntryRegistrationState({
        role,
        memberExists: memberSnapshot.exists,
        projectIds: memberAccess.projectIds,
      }),
    });
  }));

  app.get('/api/v1/portal/weekly-expenses-summary', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read portal weekly expenses summary');
    const { tenantId, actorId, actorRole } = req.context;
    const { memberSnapshot, member, memberAccess, role, activeProjectId, activeProject } = await resolvePortalReadModelContext(
      db,
      tenantId,
      actorId,
      actorRole,
    );
    const activeProjectDoc = activeProjectId
      ? await db.doc(`orgs/${tenantId}/projects/${activeProjectId}`).get()
      : null;
    const currentProject = activeProjectDoc?.exists
      ? { id: activeProjectDoc.id, ...(activeProjectDoc.data() || {}) }
      : activeProject || null;
    if (!currentProject) {
      throw createHttpError(404, '활성 사업을 찾을 수 없습니다.', 'project_not_found');
    }

    const weeklyData = await loadWeeklyExpenseData(db, tenantId, currentProject.id);
    const summary = buildPortalWeeklyExpensesSummary({
      project: currentProject,
      todayIso: getSeoulTodayIso(),
      weeklySubmissionStatuses: weeklyData.weeklySubmissionStatuses,
      expenseSheets: weeklyData.expenseSheets,
      bankStatementRows: weeklyData.bankStatementRows,
      sheetSources: weeklyData.sheetSources,
      bankStatementLastSavedAt: weeklyData.bankStatementLastSavedAt,
    });

    res.status(200).json({
      ...summary,
      registrationState: resolvePortalEntryRegistrationState({
        role,
        memberExists: memberSnapshot.exists,
        projectIds: memberAccess.projectIds,
      }),
    });
  }));

  app.get('/api/v1/portal/bank-statements-summary', asyncHandler(async (req, res) => {
    assertActorRoleAllowed(req, ROUTE_ROLES.readCore, 'read portal bank statements summary');
    const { tenantId, actorId, actorRole } = req.context;
    const { memberSnapshot, member, memberAccess, role, activeProjectId, activeProject } = await resolvePortalReadModelContext(
      db,
      tenantId,
      actorId,
      actorRole,
    );
    const activeProjectDoc = activeProjectId
      ? await db.doc(`orgs/${tenantId}/projects/${activeProjectId}`).get()
      : null;
    const currentProject = activeProjectDoc?.exists
      ? { id: activeProjectDoc.id, ...(activeProjectDoc.data() || {}) }
      : activeProject || null;
    if (!currentProject) {
      throw createHttpError(404, '활성 사업을 찾을 수 없습니다.', 'project_not_found');
    }

    const weeklyData = await loadWeeklyExpenseData(db, tenantId, currentProject.id);
    const summary = buildPortalBankStatementsSummary({
      project: currentProject,
      activeExpenseSheetId: weeklyData.expenseSheets.find((sheet) => sheet.id === 'default')?.id || weeklyData.expenseSheets[0]?.id || 'default',
      expenseSheets: weeklyData.expenseSheets,
      bankStatementRows: weeklyData.bankStatementRows,
      bankStatementLastSavedAt: weeklyData.bankStatementLastSavedAt,
    });

    res.status(200).json({
      ...summary,
      registrationState: resolvePortalEntryRegistrationState({
        role,
        memberExists: memberSnapshot.exists,
        projectIds: memberAccess.projectIds,
      }),
    });
  }));
}
