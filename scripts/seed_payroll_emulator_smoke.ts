import admin from 'firebase-admin';
import {
  computePlannedPayDate,
  getSeoulTodayIso,
  subtractBusinessDays,
} from '../src/app/platform/business-days';

const ORG_COLLECTIONS = {
  projects: 'projects',
  ledgers: 'ledgers',
  transactions: 'transactions',
  payrollSchedules: 'payroll_schedules',
  payrollRuns: 'payroll_runs',
} as const;

type OrgCollectionKey = keyof typeof ORG_COLLECTIONS;

function getOrgDocumentPath(orgId: string, key: OrgCollectionKey, docId: string): string {
  return `orgs/${orgId}/${ORG_COLLECTIONS[key]}/${docId}`;
}

function readStringEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const firestoreHost = readStringEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  const projectId = readStringEnv('FIREBASE_PROJECT_ID', 'demo-mysc');
  const tenantId = readStringEnv('PAYROLL_ORG_ID', 'mysc').toLowerCase();
  const payrollProjectId = readStringEnv('PAYROLL_PROJECT_ID', 'p002');
  const payrollProjectName = readStringEnv('PAYROLL_PROJECT_NAME', 'KOICA 플랫폼 ESG 이니셔티브 (IBS) 2 (w.유한킴벌리)');
  const ledgerId = readStringEnv('PAYROLL_LEDGER_ID', 'l003');
  const dayOfMonth = Math.max(1, Math.min(31, readIntEnv('PAYROLL_DAY_OF_MONTH', 16)));
  const yearMonth = readStringEnv('PAYROLL_YEAR_MONTH', getSeoulTodayIso().slice(0, 7));
  const plannedPayDate = computePlannedPayDate(yearMonth, dayOfMonth);
  const noticeDate = subtractBusinessDays(plannedPayDate, 3);
  const runId = `${payrollProjectId}-${yearMonth}`;
  const transactionId = readStringEnv('PAYROLL_TX_ID', 'tx-emu-payroll-001');
  const now = new Date().toISOString();
  const deleteField = admin.firestore.FieldValue.delete();

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();
  db.settings({ host: firestoreHost, ssl: false });

  const projectRef = db.doc(getOrgDocumentPath(tenantId, 'projects', payrollProjectId));
  const ledgerRef = db.doc(getOrgDocumentPath(tenantId, 'ledgers', ledgerId));
  const txRef = db.doc(getOrgDocumentPath(tenantId, 'transactions', transactionId));
  const scheduleRef = db.doc(getOrgDocumentPath(tenantId, 'payrollSchedules', payrollProjectId));
  const runRef = db.doc(getOrgDocumentPath(tenantId, 'payrollRuns', runId));

  await projectRef.set({
    id: payrollProjectId,
    tenantId,
    name: payrollProjectName,
    shortName: payrollProjectId,
    clientName: 'KOICA',
    status: 'IN_PROGRESS',
    type: 'D1',
    basis: '공급가액',
    accountType: 'NONE',
    totalBudget: 2500000000,
    pmName: '에뮬레이터 PM',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await ledgerRef.set({
    id: ledgerId,
    tenantId,
    projectId: payrollProjectId,
    name: 'Payroll Smoke Ledger',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await txRef.set({
    id: transactionId,
    tenantId,
    projectId: payrollProjectId,
    ledgerId,
    dateTime: plannedPayDate,
    direction: 'OUT',
    amount: 47000000,
    cashflowCategory: 'LABOR_COST',
    counterparty: 'MYSC Payroll',
    memo: `${yearMonth} 프로젝트 인건비 (emulator smoke)`,
    state: 'APPROVED',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  await scheduleRef.set({
    id: payrollProjectId,
    tenantId,
    projectId: payrollProjectId,
    dayOfMonth,
    timezone: 'Asia/Seoul',
    noticeLeadBusinessDays: 3,
    active: true,
    updatedAt: now,
    updatedBy: 'seed-script',
    updatedByName: 'seed-script',
    createdAt: now,
    createdBy: 'seed-script',
  }, { merge: true });

  await runRef.set({
    id: runId,
    tenantId,
    projectId: payrollProjectId,
    yearMonth,
    plannedPayDate,
    noticeDate,
    noticeLeadBusinessDays: 3,
    acknowledged: false,
    paidStatus: 'UNKNOWN',
    matchedTxIds: [],
    reviewCandidates: [],
    pmReviewStatus: 'PENDING',
    missingCandidateAlertAt: deleteField,
    pmReviewCompletedAt: deleteField,
    pmReviewCompletedByUid: deleteField,
    pmReviewCompletedByName: deleteField,
    confirmedAt: deleteField,
    confirmedByUid: deleteField,
    confirmedByName: deleteField,
    acknowledgedAt: deleteField,
    acknowledgedByUid: deleteField,
    acknowledgedByName: deleteField,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  const legacyScheduleRef = db.doc(`orgs/${tenantId}/payrollSchedules/${payrollProjectId}`);
  const legacyRunRef = db.doc(`orgs/${tenantId}/payrollRuns/${runId}`);
  const [legacySchedule, legacyRun] = await Promise.all([legacyScheduleRef.get(), legacyRunRef.get()]);
  if (legacySchedule.exists) await legacyScheduleRef.delete();
  if (legacyRun.exists) await legacyRunRef.delete();

  console.log(`[seed:payroll:emulator-smoke] Firestore host: ${firestoreHost}`);
  console.log(`[seed:payroll:emulator-smoke] canonical schedule: ${scheduleRef.path}`);
  console.log(`[seed:payroll:emulator-smoke] canonical run: ${runRef.path}`);
  console.log(`[seed:payroll:emulator-smoke] transaction: ${txRef.path}`);
  console.log(`[seed:payroll:emulator-smoke] legacy cleanup: schedule=${legacySchedule.exists} run=${legacyRun.exists}`);
}

main().catch((error) => {
  console.error('[seed:payroll:emulator-smoke] failed:', error);
  process.exit(1);
});
