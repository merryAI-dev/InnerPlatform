import type { Project } from './types';

type CompletenessField = {
  key: string;
  label: string;
  isFilled: (project: Partial<Project>) => boolean;
};

const FIELDS: CompletenessField[] = [
  { key: 'department', label: '담당조직', isFilled: (p) => !!String(p.department || '').trim() },
  { key: 'clientOrg', label: '발주기관', isFilled: (p) => !!String(p.clientOrg || '').trim() },
  { key: 'managerName', label: '메인 담당자', isFilled: (p) => !!String(p.managerName || '').trim() },
  { key: 'managerId', label: '담당자 계정', isFilled: (p) => !!String(p.managerId || '').trim() },
  { key: 'accountType', label: '통장 구분', isFilled: (p) => String(p.accountType || '') !== 'NONE' && !!p.accountType },
  { key: 'contractStart', label: '계약 시작일', isFilled: (p) => !!String(p.contractStart || '').trim() },
  { key: 'contractEnd', label: '계약 종료일', isFilled: (p) => !!String(p.contractEnd || '').trim() },
  { key: 'contractAmount', label: '총 사업비', isFilled: (p) => Number(p.contractAmount || 0) > 0 },
  { key: 'paymentPlanDesc', label: '입금 계획', isFilled: (p) => !!String(p.paymentPlanDesc || '').trim() },
  { key: 'groupwareName', label: '그룹웨어 등록명', isFilled: (p) => !!String(p.groupwareName || '').trim() },
];

export interface ProjectCompletenessResult {
  percent: number;
  filled: number;
  total: number;
  missing: { key: string; label: string }[];
}

export function computeProjectCompleteness(project: Partial<Project>): ProjectCompletenessResult {
  const total = FIELDS.length;
  let filled = 0;
  const missing: { key: string; label: string }[] = [];

  for (const field of FIELDS) {
    if (field.isFilled(project)) {
      filled += 1;
    } else {
      missing.push({ key: field.key, label: field.label });
    }
  }

  const percent = total > 0 ? Math.round((filled / total) * 100) : 0;
  return { percent, filled, total, missing };
}

