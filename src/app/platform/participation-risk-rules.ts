/**
 * 참여율 이상 탐지 — 규칙 기반 (AI 불필요)
 *
 * 역할:
 * - 정산 제출 전 참여율 위험 직원 추출 (100% 초과)
 * - 대시보드용 위험 직원 요약 제공
 *
 * 기존 `computeCrossVerifyGroups` / `computeMemberSummaries`(participation-data.ts) 를
 * 순수 함수로 래핑해 저장/제출 직전 체크용 API를 제공.
 */

import type { ParticipationEntry } from '../data/types';
import { computeCrossVerifyGroups } from '../data/participation-data';

export interface ParticipationRiskResult {
  /** 100% 초과 그룹이 존재하는 직원 목록 */
  overLimitMembers: {
    memberId: string;
    memberName: string;
    /** 초과된 그룹 라벨 (예: "e나라도움 정산") */
    groupLabel: string;
    /** 합산 참여율 */
    totalRate: number;
    /** 해당 그룹의 프로젝트명 목록 */
    projectNames: string[];
  }[];
  /** 80% 초과(경고) 그룹이 존재하는 직원 목록 */
  warningMembers: {
    memberId: string;
    memberName: string;
    groupLabel: string;
    totalRate: number;
  }[];
  hasOverLimit: boolean;
  hasWarning: boolean;
}

/**
 * 전체 participationEntries에서 위험(100% 초과) / 경고(80% 초과) 직원을 추출한다.
 *
 * @param entries 전체 참여율 항목 (모든 프로젝트 포함)
 * @param filterMemberNames 특정 직원 이름으로 필터링 (제출 주간 참여자만 체크할 때)
 */
export function detectParticipationRisk(
  entries: ParticipationEntry[],
  filterMemberNames?: string[],
): ParticipationRiskResult {
  const filtered = filterMemberNames && filterMemberNames.length > 0
    ? entries.filter((e) => filterMemberNames.some((name) => name === e.memberName))
    : entries;

  const groups = computeCrossVerifyGroups(filtered);

  const overLimitMembers = groups
    .filter((g) => g.isOverLimit)
    .map((g) => ({
      memberId: g.memberId,
      memberName: g.memberName,
      groupLabel: g.groupLabel,
      totalRate: g.totalRate,
      projectNames: g.entries.map((e) => e.projectName || e.projectId),
    }));

  const warningMembers = groups
    .filter((g) => !g.isOverLimit && g.risk === 'MEDIUM')
    .map((g) => ({
      memberId: g.memberId,
      memberName: g.memberName,
      groupLabel: g.groupLabel,
      totalRate: g.totalRate,
    }));

  // memberId 기준 중복 제거 (여러 그룹에서 초과된 경우)
  const seenOver = new Set<string>();
  const uniqueOver = overLimitMembers.filter((m) => {
    const key = `${m.memberId}::${m.groupLabel}`;
    if (seenOver.has(key)) return false;
    seenOver.add(key);
    return true;
  });

  const seenWarn = new Set<string>();
  const uniqueWarn = warningMembers.filter((m) => {
    const key = `${m.memberId}::${m.groupLabel}`;
    if (seenWarn.has(key)) return false;
    seenWarn.add(key);
    return true;
  });

  return {
    overLimitMembers: uniqueOver,
    warningMembers: uniqueWarn,
    hasOverLimit: uniqueOver.length > 0,
    hasWarning: uniqueWarn.length > 0,
  };
}

/**
 * 제출 차단 여부 결정
 *
 * 현재 정책: 100% 초과 시 경고만 표시하고 제출은 허용 (사용자 인지 후 진행)
 * 향후 Admin 설정으로 "hard block" 옵션 추가 가능
 */
export function shouldBlockSubmission(_risk: ParticipationRiskResult): boolean {
  return false; // soft warning only
}
