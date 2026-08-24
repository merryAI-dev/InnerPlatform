import { readOptionalText } from './bff-utils.mjs';

export const SETTLEMENT_SYSTEM_CODES = new Set([
  'E_NARA_DOUM', 'IRIS', 'RCMS', 'EZBARO', 'E_HIJO', 'EDUFINE',
  'HAPPYEUM', 'AGRIX', 'BOTAEM_E', 'SMTECH', 'KOCCA_PMS', 'NIPA',
  'ACCOUNTANT', 'PRIVATE', 'OTHER', 'NONE',
]);

export const PARTICIPATION_RULE_SETTLEMENT_SYSTEM_CODES = [
  'NONE', 'E_NARA_DOUM', 'BOTAEM_E', 'RCMS', 'EZBARO',
  'SMTECH', 'KOCCA_PMS', 'NIPA', 'IRIS', 'OTHER',
];

export const PARTICIPATION_SETTLEMENT_SYSTEM_LABELS = {
  E_NARA_DOUM: 'e나라도움 (국고보조금통합관리시스템)',
  IRIS: 'IRIS(범부처통합연구지원시스템)',
  RCMS: 'RCMS (실시간연구비관리시스템)',
  EZBARO: '통합이지바로 (통합 Ez-plus)',
  E_HIJO: 'e호조 (지방재정)',
  EDUFINE: '에듀파인 (교육재정)',
  HAPPYEUM: '행복이음 (사회보장)',
  AGRIX: '아그릭스 (농림사업)',
  BOTAEM_E: '보탬e(지방보조금관리시스템)',
  SMTECH: 'SMTECH (중소기업기술개발사업종합관리시스템)',
  KOCCA_PMS: 'KOCCA PMS',
  NIPA: 'NIPA 사업관리시스템',
  ACCOUNTANT: '회계사정산',
  PRIVATE: '민간사업',
  OTHER: '기타',
  NONE: '시스템 미사용',
};

export function normalizeSettlementSystemCode(value) {
  const normalized = readOptionalText(value);
  return SETTLEMENT_SYSTEM_CODES.has(normalized) ? normalized : 'NONE';
}

export function normalizeBasis(value) {
  if (value === 'SUPPLY_AMOUNT' || value === '공급가액') return '공급가액';
  if (value === 'SUPPLY_PRICE' || value === '공급대가') return '공급대가';
  if (value === 'OTHER' || value === '기타') return '기타';
  return 'NONE';
}

export function resolveParticipationSettlementSystem(project) {
  if (
    Number(project?.registrationRequirementsVersion) === 2
    && normalizeBasis(project?.basis) === 'NONE'
  ) return 'NONE';
  const selectedSystem = normalizeSettlementSystemCode(project?.settlementSystem);
  if (selectedSystem !== 'NONE') return selectedSystem;
  if (project?.settlementType === 'TYPE5' || project?.accountType === 'DEDICATED') {
    return 'E_NARA_DOUM';
  }
  if (project?.settlementType === 'NONE' && project?.accountType === 'NONE') {
    return 'NONE';
  }
  return 'PRIVATE';
}
