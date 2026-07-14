import type { Project } from '../data/types';
import { normalizeProjectRevenueFields } from './project-financials';

export interface ProjectMonthlyPerformance {
  key: string;
  label: string;
  contractAmount: number;
  totalRevenueAmount: number;
}

function validDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function approvalDate(project: Project): Date | null {
  const historyDate = [...(project.executiveReviewHistory || [])]
    .reverse()
    .find((entry) => entry.status === 'APPROVED' && validDate(entry.reviewedAt))?.reviewedAt;
  return validDate(historyDate) || validDate(project.executiveReviewedAt);
}

function kstYearMonth(date: Date) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(values.find((part) => part.type === 'year')?.value),
    month: Number(values.find((part) => part.type === 'month')?.value),
  };
}

export function buildProjectMonthlyPerformance(projects: Project[], now = new Date()): ProjectMonthlyPerformance[] {
  const current = kstYearMonth(now);
  const months = Array.from({ length: current.month }, (_, index) => {
    const month = index + 1;
    return {
      key: `${current.year}-${String(month).padStart(2, '0')}`,
      label: `${month}월`,
      contractAmount: 0,
      totalRevenueAmount: 0,
    };
  });
  const monthByKey = new Map(months.map((month) => [month.key, month]));

  projects.forEach((project) => {
    const approvedAt = approvalDate(project);
    if (!approvedAt) return;
    const { year, month } = kstYearMonth(approvedAt);
    const target = monthByKey.get(`${year}-${String(month).padStart(2, '0')}`);
    if (!target) return;
    target.contractAmount += project.contractAmount;
    target.totalRevenueAmount += normalizeProjectRevenueFields(project, 'totalRevenueAmount').totalRevenueAmount;
  });

  return months;
}
