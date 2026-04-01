import type { Project } from '../data/types';

function normalizeAmountInput(value: string): string {
  return String(value || '').replace(/,/g, '').trim();
}

export function parseProjectAmountInput(value: string): number {
  const normalized = normalizeAmountInput(value);
  if (!normalized) return 0;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasExplicitProjectAmountInput(value: string): boolean {
  const normalized = normalizeAmountInput(value);
  if (!normalized) return false;

  return Number.isFinite(Number(normalized));
}

export function hasNonNegativeProjectAmountInput(value: string): boolean {
  return hasExplicitProjectAmountInput(value) && parseProjectAmountInput(value) >= 0;
}

export function formatProjectAmountInput(value: number, hasExplicitValue: boolean): string {
  if (!hasExplicitValue || !Number.isFinite(value)) return '';
  return value.toLocaleString('ko-KR');
}

export function hasStoredProjectContractAmount(project: Partial<Project>): boolean {
  return typeof project.contractAmount === 'number' && Number.isFinite(project.contractAmount);
}
