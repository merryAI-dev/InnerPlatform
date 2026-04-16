import type {
  PayrollCandidateReviewDecision,
  PayrollPaidStatus,
  PayrollReviewStatus,
} from '../data/types';

export function getPayrollPaidStatusLabel(status: PayrollPaidStatus): string {
  if (status === 'AUTO_MATCHED') return '자동매칭';
  if (status === 'CONFIRMED') return '확정';
  if (status === 'MISSING') return '후보 없음';
  return '미확인';
}

export function getPayrollPaidStatusTone(status: PayrollPaidStatus): string {
  if (status === 'AUTO_MATCHED') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  if (status === 'CONFIRMED') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (status === 'MISSING') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export function getPayrollReviewStatusLabel(status: PayrollReviewStatus): string {
  if (status === 'COMPLETED') return 'PM 검토 완료';
  if (status === 'MISSING_CANDIDATE') return '후보 없음';
  return 'PM 검토 대기';
}

export function getPayrollReviewStatusTone(status: PayrollReviewStatus): string {
  if (status === 'COMPLETED') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (status === 'MISSING_CANDIDATE') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
}

export function getPayrollDecisionLabel(decision: PayrollCandidateReviewDecision): string {
  if (decision === 'PAYROLL') return '인건비';
  if (decision === 'NOT_PAYROLL') return '아님';
  if (decision === 'HOLD') return '보류';
  return '대기';
}

export function getPayrollDecisionTone(decision: PayrollCandidateReviewDecision): string {
  if (decision === 'PAYROLL') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (decision === 'NOT_PAYROLL') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (decision === 'HOLD') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}
