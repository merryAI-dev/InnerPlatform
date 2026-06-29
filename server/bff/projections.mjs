function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toArrayFromDocSnap(snap) {
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function normalizeStatus(value, fallback = '') {
  return typeof value === 'string' ? value.trim().toUpperCase() : fallback;
}

function normalizeDirection(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeEntityType(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readTransactionAmount(tx) {
  const direct = toNumber(tx.amount);
  if (direct > 0) return direct;
  return toNumber(tx?.amounts?.bankAmount);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatIsoDate(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function addDaysUtc(isoDate, deltaDays) {
  const [yRaw, mRaw, dRaw] = String(isoDate).split('-');
  const year = Number.parseInt(yRaw, 10);
  const month = Number.parseInt(mRaw, 10);
  const day = Number.parseInt(dRaw, 10);
  const base = Date.UTC(year, month - 1, day);
  const next = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  return formatIsoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function getMonthMondayWeeks(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(yearMonth || ''))) return [];
  const [yyyyRaw, mmRaw] = String(yearMonth).split('-');
  const year = Number.parseInt(yyyyRaw, 10);
  const month = Number.parseInt(mmRaw, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return [];

  let firstMondayDay = 0;
  for (let d = 1; d <= 7; d += 1) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === 1) {
      firstMondayDay = d;
      break;
    }
  }
  if (!firstMondayDay) return [];

  const weeks = [];
  for (let i = 0, day = firstMondayDay; i < 6; i += 1, day += 7) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() + 1 !== month) break;
    const weekNo = i + 1;
    const weekStart = formatIsoDate(year, month, day);
    weeks.push({
      yearMonth,
      weekNo,
      weekStart,
      weekEnd: addDaysUtc(weekStart, 6),
    });
  }
  return weeks;
}

function resolveYearMonthFromDate(dateTime) {
  const date = typeof dateTime === 'string' ? dateTime.slice(0, 10) : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return date.slice(0, 7);
}

function findWeekForDate(dateIso, weeks) {
  return weeks.find((week) => dateIso >= week.weekStart && dateIso <= week.weekEnd) || null;
}

function resolveCashflowLine(tx) {
  const direction = normalizeDirection(tx.direction);
  const category = normalizeStatus(tx.cashflowCategory);

  if (direction === 'IN') {
    if (category === 'VAT_REFUND') return 'SALES_VAT_IN';
    if (category === 'BANK_INTEREST_IN') return 'BANK_INTEREST_IN';
    if (category === 'MISC_INCOME') return 'TEAM_SUPPORT_IN';
    return 'SALES_IN';
  }

  if (direction === 'OUT') {
    if (category === 'LABOR_COST') return 'MYSC_LABOR_OUT';
    if (category === 'TAX_PAYMENT') return 'SALES_VAT_OUT';
    if (category === 'BANK_INTEREST_OUT') return 'BANK_INTEREST_OUT';
    if (toNumber(tx?.amounts?.vatIn) > 0) return 'INPUT_VAT_OUT';
    return 'DIRECT_COST_OUT';
  }

  return '';
}

export async function recomputeProjectFinancials(db, tenantId, nowIso) {
  const [projectSnap, txSnap, expenseSetSnap, changeReqSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/projects`).get(),
    db.collection(`orgs/${tenantId}/transactions`).get(),
    db.collection(`orgs/${tenantId}/expense_sets`).get(),
    db.collection(`orgs/${tenantId}/change_requests`).get(),
  ]);

  const projects = toArrayFromDocSnap(projectSnap);
  const transactions = toArrayFromDocSnap(txSnap);
  const expenseSets = toArrayFromDocSnap(expenseSetSnap);
  const changeRequests = toArrayFromDocSnap(changeReqSnap);

  const byProject = {};
  for (const project of projects) {
    byProject[project.id] = {
      projectId: project.id,
      projectName: project.name || project.id,
      totalIn: 0,
      totalOut: 0,
      balance: 0,
      approvedTxCount: 0,
      submittedTxCount: 0,
      pendingExpenseSetCount: 0,
      pendingChangeRequestCount: 0,
      updatedAt: nowIso,
    };
  }

  for (const tx of transactions) {
    const projectId = typeof tx.projectId === 'string' ? tx.projectId : '';
    if (!projectId) continue;
    if (!byProject[projectId]) {
      byProject[projectId] = {
        projectId,
        projectName: projectId,
        totalIn: 0,
        totalOut: 0,
        balance: 0,
        approvedTxCount: 0,
        submittedTxCount: 0,
        pendingExpenseSetCount: 0,
        pendingChangeRequestCount: 0,
        updatedAt: nowIso,
      };
    }

    const amount = readTransactionAmount(tx);
    const state = normalizeStatus(tx.state);
    const direction = normalizeDirection(tx.direction);

    if (state === 'APPROVED') {
      if (direction === 'IN') byProject[projectId].totalIn += amount;
      if (direction === 'OUT') byProject[projectId].totalOut += amount;
      byProject[projectId].approvedTxCount += 1;
    }
    if (state === 'SUBMITTED') {
      byProject[projectId].submittedTxCount += 1;
    }
  }

  for (const item of expenseSets) {
    if (normalizeStatus(item.status) !== 'SUBMITTED') continue;
    const projectId = typeof item.projectId === 'string' ? item.projectId : '';
    if (!projectId || !byProject[projectId]) continue;
    byProject[projectId].pendingExpenseSetCount += 1;
  }

  for (const item of changeRequests) {
    if (normalizeStatus(item.state) !== 'SUBMITTED') continue;
    const projectId = typeof item.projectId === 'string' ? item.projectId : '';
    if (!projectId || !byProject[projectId]) continue;
    byProject[projectId].pendingChangeRequestCount += 1;
  }

  const projectsPayload = Object.values(byProject).map((entry) => ({
    ...entry,
    balance: entry.totalIn - entry.totalOut,
  }));

  const payload = {
    tenantId,
    view: 'project_financials',
    updatedAt: nowIso,
    projects: projectsPayload,
  };
  await db.doc(`orgs/${tenantId}/views/project_financials`).set(payload, { merge: true });
  return payload;
}

export async function recomputeApprovalInbox(db, tenantId, nowIso) {
  const [txSnap, expenseSetSnap, changeReqSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/transactions`).get(),
    db.collection(`orgs/${tenantId}/expense_sets`).get(),
    db.collection(`orgs/${tenantId}/change_requests`).get(),
  ]);

  const items = [];

  for (const tx of toArrayFromDocSnap(txSnap)) {
    if (normalizeStatus(tx.state) !== 'SUBMITTED') continue;
    items.push({
      itemType: 'transaction',
      itemId: tx.id,
      projectId: tx.projectId || null,
      title: tx.counterparty || tx.id,
      amount: readTransactionAmount(tx),
      priority: 'MEDIUM',
      submittedAt: normalizeTimestamp(tx.submittedAt || tx.updatedAt, nowIso),
      state: 'SUBMITTED',
    });
  }

  for (const expenseSet of toArrayFromDocSnap(expenseSetSnap)) {
    if (normalizeStatus(expenseSet.status) !== 'SUBMITTED') continue;
    items.push({
      itemType: 'expense_set',
      itemId: expenseSet.id,
      projectId: expenseSet.projectId || null,
      title: expenseSet.title || expenseSet.id,
      amount: toNumber(expenseSet.totalGross),
      priority: 'MEDIUM',
      submittedAt: normalizeTimestamp(expenseSet.submittedAt || expenseSet.updatedAt, nowIso),
      state: 'SUBMITTED',
    });
  }

  for (const request of toArrayFromDocSnap(changeReqSnap)) {
    if (normalizeStatus(request.state) !== 'SUBMITTED') continue;
    items.push({
      itemType: 'change_request',
      itemId: request.id,
      projectId: request.projectId || null,
      title: request.title || request.id,
      amount: null,
      priority: normalizeStatus(request.priority, 'MEDIUM'),
      submittedAt: normalizeTimestamp(request.requestedAt || request.updatedAt, nowIso),
      state: 'SUBMITTED',
    });
  }

  items.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

  const payload = {
    tenantId,
    view: 'approval_inbox',
    updatedAt: nowIso,
    totalPending: items.length,
    items,
  };
  await db.doc(`orgs/${tenantId}/views/approval_inbox`).set(payload, { merge: true });
  return payload;
}

export async function recomputeMemberWorkload(db, tenantId, nowIso) {
  const [txSnap, changeReqSnap, memberSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/transactions`).get(),
    db.collection(`orgs/${tenantId}/change_requests`).get(),
    db.collection(`orgs/${tenantId}/members`).get(),
  ]);

  const byMember = {};

  for (const member of toArrayFromDocSnap(memberSnap)) {
    byMember[member.id] = {
      memberId: member.id,
      name: member.name || member.email || member.id,
      role: member.role || null,
      submittedTransactions: 0,
      approvedTransactions: 0,
      requestedChanges: 0,
      reviewedChanges: 0,
      updatedAt: nowIso,
    };
  }

  for (const tx of toArrayFromDocSnap(txSnap)) {
    const submittedBy = typeof tx.submittedBy === 'string' ? tx.submittedBy : '';
    const approvedBy = typeof tx.approvedBy === 'string' ? tx.approvedBy : '';
    if (submittedBy) {
      if (!byMember[submittedBy]) {
        byMember[submittedBy] = {
          memberId: submittedBy,
          name: submittedBy,
          role: null,
          submittedTransactions: 0,
          approvedTransactions: 0,
          requestedChanges: 0,
          reviewedChanges: 0,
          updatedAt: nowIso,
        };
      }
      byMember[submittedBy].submittedTransactions += 1;
    }
    if (approvedBy) {
      if (!byMember[approvedBy]) {
        byMember[approvedBy] = {
          memberId: approvedBy,
          name: approvedBy,
          role: null,
          submittedTransactions: 0,
          approvedTransactions: 0,
          requestedChanges: 0,
          reviewedChanges: 0,
          updatedAt: nowIso,
        };
      }
      byMember[approvedBy].approvedTransactions += 1;
    }
  }

  for (const request of toArrayFromDocSnap(changeReqSnap)) {
    const requester = typeof request.requestedBy === 'string' ? request.requestedBy : '';
    const reviewer = typeof request.reviewedBy === 'string' ? request.reviewedBy : '';

    if (requester) {
      if (!byMember[requester]) {
        byMember[requester] = {
          memberId: requester,
          name: requester,
          role: null,
          submittedTransactions: 0,
          approvedTransactions: 0,
          requestedChanges: 0,
          reviewedChanges: 0,
          updatedAt: nowIso,
        };
      }
      byMember[requester].requestedChanges += 1;
    }

    if (reviewer) {
      if (!byMember[reviewer]) {
        byMember[reviewer] = {
          memberId: reviewer,
          name: reviewer,
          role: null,
          submittedTransactions: 0,
          approvedTransactions: 0,
          requestedChanges: 0,
          reviewedChanges: 0,
          updatedAt: nowIso,
        };
      }
      byMember[reviewer].reviewedChanges += 1;
    }
  }

  const payload = {
    tenantId,
    view: 'member_workload',
    updatedAt: nowIso,
    members: Object.values(byMember),
  };
  await db.doc(`orgs/${tenantId}/views/member_workload`).set(payload, { merge: true });
  return payload;
}

export async function recomputeAlerts(db, tenantId, nowIso) {
  const [inboxSnap, financialSnap] = await Promise.all([
    db.doc(`orgs/${tenantId}/views/approval_inbox`).get(),
    db.doc(`orgs/${tenantId}/views/project_financials`).get(),
  ]);

  const inbox = inboxSnap.exists ? inboxSnap.data() || {} : {};
  const financials = financialSnap.exists ? financialSnap.data() || {} : {};
  const projects = Array.isArray(financials.projects) ? financials.projects : [];
  const highBurnProjects = projects.filter((project) => {
    const totalIn = toNumber(project.totalIn);
    const totalOut = toNumber(project.totalOut);
    if (totalIn <= 0) return false;
    return totalOut / totalIn >= 0.85;
  }).length;

  const payload = {
    tenantId,
    view: 'alerts',
    updatedAt: nowIso,
    approvalPending: toNumber(inbox.totalPending),
    highBurnProjects,
    hasBlockingAlert: toNumber(inbox.totalPending) > 0 || highBurnProjects > 0,
  };
  await db.doc(`orgs/${tenantId}/views/alerts`).set(payload, { merge: true });
  return payload;
}

export async function recomputeCashflowWeeks(db, tenantId, nowIso) {
  const [txSnap, weekSnap] = await Promise.all([
    db.collection(`orgs/${tenantId}/transactions`).get(),
    db.collection(`orgs/${tenantId}/cashflow_weeks`).get(),
  ]);
  const byWeek = new Map();

  for (const tx of toArrayFromDocSnap(txSnap)) {
    if (normalizeStatus(tx.state) !== 'APPROVED') continue;
    const projectId = typeof tx.projectId === 'string' ? tx.projectId.trim() : '';
    const dateIso = typeof tx.dateTime === 'string' ? tx.dateTime.slice(0, 10) : '';
    const yearMonth = resolveYearMonthFromDate(tx.dateTime);
    const lineId = resolveCashflowLine(tx);
    if (!projectId || !yearMonth || !lineId || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) continue;

    const week = findWeekForDate(dateIso, getMonthMondayWeeks(yearMonth));
    if (!week) continue;

    const id = `${projectId}-${yearMonth}-w${week.weekNo}`;
    if (!byWeek.has(id)) {
      byWeek.set(id, {
        id,
        tenantId,
        projectId,
        yearMonth,
        weekNo: week.weekNo,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        actual: {},
      });
    }

    const amount = readTransactionAmount(tx);
    const entry = byWeek.get(id);
    entry.actual[lineId] = toNumber(entry.actual[lineId]) + amount;
  }

  const existingWeeks = toArrayFromDocSnap(weekSnap);
  for (const week of existingWeeks) {
    if (!week.id || !week.projectId || !week.yearMonth || !week.weekNo || !week.weekStart || !week.weekEnd) continue;
    if (!byWeek.has(week.id)) {
      byWeek.set(week.id, {
        id: week.id,
        tenantId,
        projectId: week.projectId,
        yearMonth: week.yearMonth,
        weekNo: week.weekNo,
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        actual: {},
      });
    }
  }

  let batch = db.batch();
  let writes = 0;
  const weeks = Array.from(byWeek.values());
  for (const week of weeks) {
    const ref = db.doc(`orgs/${tenantId}/cashflow_weeks/${week.id}`);
    batch.set(ref, {
      id: week.id,
      tenantId,
      projectId: week.projectId,
      yearMonth: week.yearMonth,
      weekNo: week.weekNo,
      weekStart: week.weekStart,
      weekEnd: week.weekEnd,
      actual: week.actual || {},
      syncedFromTransactionsAt: nowIso,
      updatedAt: nowIso,
      updatedByUid: 'system',
      updatedByName: 'System',
    }, { merge: true });
    writes += 1;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();

  const payload = {
    tenantId,
    view: 'cashflow_weeks',
    updatedAt: nowIso,
    syncedWeeks: weeks.length,
  };
  await db.doc(`orgs/${tenantId}/views/cashflow_weeks`).set(payload, { merge: true });
  return payload;
}

const VIEW_REBUILDERS = {
  project_financials: recomputeProjectFinancials,
  approval_inbox: recomputeApprovalInbox,
  member_workload: recomputeMemberWorkload,
  alerts: recomputeAlerts,
  cashflow_weeks: recomputeCashflowWeeks,
};

export function listSupportedViews() {
  return Object.keys(VIEW_REBUILDERS);
}

export async function rebuildView(db, tenantId, viewName, nowIso) {
  const key = normalizeEntityType(viewName);
  const rebuilder = VIEW_REBUILDERS[key];
  if (!rebuilder) {
    const error = new Error(`Unsupported view: ${viewName}`);
    error.statusCode = 400;
    throw error;
  }
  return rebuilder(db, tenantId, nowIso);
}
