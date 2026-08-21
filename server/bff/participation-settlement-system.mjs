import { readOptionalText } from './bff-utils.mjs';

export const SETTLEMENT_SYSTEM_CODES = new Set([
  'E_NARA_DOUM', 'IRIS', 'RCMS', 'EZBARO', 'E_HIJO', 'EDUFINE',
  'HAPPYEUM', 'AGRIX', 'BOTAEM_E', 'SMTECH', 'KOCCA_PMS', 'NIPA',
  'ACCOUNTANT', 'PRIVATE', 'OTHER', 'NONE',
]);

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
