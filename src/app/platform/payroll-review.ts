import { addBusinessDays } from './business-days';
import type {
  PayrollCandidateReviewDecision,
  PayrollPaidStatus,
  PayrollReviewCandidate,
  PayrollReviewStatus,
  PayrollRun,
  Project,
  Transaction,
} from '../data/types';

const PAYROLL_KEYWORDS = ['급여', '인건비', '월급', 'salary', 'payroll', '상여'];

export interface PayrollReviewWindow {
  start: string;
  end: string;
}

export interface PayrollRunReviewState {
  runId: string;
  projectId: string;
  yearMonth: string;
  plannedPayDate: string;
  windowStart: string;
  windowEnd: string;
  reviewCandidates: PayrollReviewCandidate[];
  pmReviewStatus: PayrollReviewStatus;
  paidStatus: PayrollPaidStatus;
  missingCandidateAlertAt?: string;
  candidateCount: number;
  pendingDecisionCount: number;
  payrollDecisionCount: number;
  canAdminConfirm: boolean;
  needsPmReview: boolean;
  hasMissingCandidate: boolean;
  needsAdminConfirm: boolean;
}

export interface PayrollReviewQueueItem extends PayrollRunReviewState {
  projectName: string;
  projectShortName: string;
}

export interface PersistablePayrollReviewSnapshot {
  reviewCandidates: PayrollReviewCandidate[];
  pmReviewStatus: PayrollReviewStatus;
  paidStatus: PayrollPaidStatus;
  missingCandidateAlertAt?: string;
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function toIsoDay(value: string): string {
  return value.slice(0, 10);
}

function buildSignals(tx: Transaction): string[] {
  const signals: string[] = [];
  if (tx.cashflowCategory === 'LABOR_COST') signals.push('cashflow:LABOR_COST');

  const memo = normalizeText(tx.memo);
  const counterparty = normalizeText(tx.counterparty);
  for (const keyword of PAYROLL_KEYWORDS) {
    if (memo.includes(keyword)) signals.push(`memo:${keyword}`);
    if (counterparty.includes(keyword)) signals.push(`counterparty:${keyword}`);
  }

  return Array.from(new Set(signals));
}

function isApprovedOutboundProjectTransaction(tx: Transaction, projectId: string): boolean {
  return tx.projectId === projectId && tx.state === 'APPROVED' && tx.direction === 'OUT';
}

function isUnresolvedDecision(decision: PayrollCandidateReviewDecision): boolean {
  return decision === 'PENDING' || decision === 'HOLD';
}

function mergeCandidate(base: PayrollReviewCandidate, persisted?: PayrollReviewCandidate): PayrollReviewCandidate {
  if (!persisted) return base;
  return {
    ...base,
    decision: persisted.decision,
    decidedAt: persisted.decidedAt,
    decidedByUid: persisted.decidedByUid,
    decidedByName: persisted.decidedByName,
    note: persisted.note,
    signals: Array.from(new Set([...persisted.signals, ...base.signals])),
  };
}

export function buildPayrollReviewWindow(plannedPayDate: string): PayrollReviewWindow {
  return {
    start: addBusinessDays(plannedPayDate, -3),
    end: addBusinessDays(plannedPayDate, 3),
  };
}

export function resolvePayrollRunReview(args: {
  run: PayrollRun;
  transactions: Transaction[];
  today: string;
}): PayrollRunReviewState {
  const { run, transactions, today } = args;
  const window = buildPayrollReviewWindow(run.plannedPayDate);
  const persistedByTxId = new Map((run.reviewCandidates || []).map((candidate) => [candidate.txId, candidate]));
  const detectedCandidates = transactions
    .filter((tx) => isApprovedOutboundProjectTransaction(tx, run.projectId))
    .filter((tx) => {
      const txDay = toIsoDay(tx.dateTime);
      return txDay >= window.start && txDay <= window.end;
    })
    .map((tx) => ({
      tx,
      signals: buildSignals(tx),
    }))
    .filter((entry) => entry.signals.length > 0)
    .sort((left, right) => left.tx.dateTime.localeCompare(right.tx.dateTime) || left.tx.id.localeCompare(right.tx.id))
    .map(({ tx, signals }) => mergeCandidate({
      txId: tx.id,
      detectedFrom: 'rule_engine',
      signals,
      decision: 'PENDING',
    }, persistedByTxId.get(tx.id)));

  const reviewCandidates = detectedCandidates;
  const candidateCount = reviewCandidates.length;
  const payrollDecisionCount = reviewCandidates.filter((candidate) => candidate.decision === 'PAYROLL').length;
  const pendingDecisionCount = reviewCandidates.filter((candidate) => isUnresolvedDecision(candidate.decision)).length;
  const dueForReview = today >= window.start;

  let pmReviewStatus: PayrollReviewStatus;
  if (candidateCount === 0 && dueForReview) {
    pmReviewStatus = 'MISSING_CANDIDATE';
  } else if (candidateCount === 0 || pendingDecisionCount > 0) {
    pmReviewStatus = 'PENDING';
  } else {
    pmReviewStatus = 'COMPLETED';
  }

  let paidStatus: PayrollPaidStatus;
  if (run.paidStatus === 'CONFIRMED') {
    paidStatus = 'CONFIRMED';
  } else if (!dueForReview && candidateCount === 0) {
    paidStatus = 'UNKNOWN';
  } else if (candidateCount === 0) {
    paidStatus = 'MISSING';
  } else if (pmReviewStatus === 'COMPLETED' && payrollDecisionCount === 0) {
    paidStatus = 'MISSING';
  } else {
    paidStatus = 'AUTO_MATCHED';
  }

  const hasMissingCandidate = candidateCount === 0 && dueForReview;
  const needsPmReview = dueForReview && candidateCount > 0 && pmReviewStatus === 'PENDING';
  const needsAdminConfirm = pmReviewStatus === 'COMPLETED' && payrollDecisionCount > 0 && paidStatus !== 'CONFIRMED';

  return {
    runId: run.id,
    projectId: run.projectId,
    yearMonth: run.yearMonth,
    plannedPayDate: run.plannedPayDate,
    windowStart: window.start,
    windowEnd: window.end,
    reviewCandidates,
    pmReviewStatus,
    paidStatus,
    missingCandidateAlertAt: hasMissingCandidate ? (run.missingCandidateAlertAt || today) : run.missingCandidateAlertAt,
    candidateCount,
    pendingDecisionCount,
    payrollDecisionCount,
    canAdminConfirm: needsAdminConfirm,
    needsPmReview,
    hasMissingCandidate,
    needsAdminConfirm,
  };
}

export function resolvePayrollReviewQueue(args: {
  projects: Project[];
  runs: PayrollRun[];
  transactions: Transaction[];
  today: string;
}): PayrollReviewQueueItem[] {
  const projectMap = new Map(args.projects.map((project) => [project.id, project]));

  return args.runs
    .map((run) => {
      const project = projectMap.get(run.projectId);
      if (!project) return null;
      const review = resolvePayrollRunReview({
        run,
        transactions: args.transactions,
        today: args.today,
      });
      if (args.today < review.windowStart) return null;
      return {
        ...review,
        projectName: project.name,
        projectShortName: project.shortName || project.id,
      } satisfies PayrollReviewQueueItem;
    })
    .filter((item): item is PayrollReviewQueueItem => Boolean(item))
    .sort((left, right) => {
      const leftScore = Number(left.hasMissingCandidate) * 300 + Number(left.needsPmReview) * 200 + Number(left.needsAdminConfirm) * 100;
      const rightScore = Number(right.hasMissingCandidate) * 300 + Number(right.needsPmReview) * 200 + Number(right.needsAdminConfirm) * 100;
      return rightScore - leftScore
        || left.plannedPayDate.localeCompare(right.plannedPayDate)
        || left.projectName.localeCompare(right.projectName, 'ko');
    });
}

export function toPayrollReviewSnapshot(review: PayrollRunReviewState): PersistablePayrollReviewSnapshot {
  return {
    reviewCandidates: review.reviewCandidates,
    pmReviewStatus: review.pmReviewStatus,
    paidStatus: review.paidStatus,
    missingCandidateAlertAt: review.missingCandidateAlertAt,
  };
}

export function payrollReviewSnapshotMatches(run: PayrollRun, review: PayrollRunReviewState): boolean {
  return JSON.stringify(run.reviewCandidates || []) === JSON.stringify(review.reviewCandidates)
    && (run.pmReviewStatus || 'PENDING') === review.pmReviewStatus
    && run.paidStatus === review.paidStatus
    && (run.missingCandidateAlertAt || undefined) === (review.missingCandidateAlertAt || undefined);
}
