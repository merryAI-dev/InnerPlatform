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

const VIEW_REBUILDERS = {
  project_financials: recomputeProjectFinancials,
  approval_inbox: recomputeApprovalInbox,
  member_workload: recomputeMemberWorkload,
  alerts: recomputeAlerts,
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
