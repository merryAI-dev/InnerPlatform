import type { ParticipationEntry, CrossVerifyRule, CrossVerifyGroup, SettlementSystemCode } from './types';
import { SETTLEMENT_SYSTEM_SHORT } from './types';

// ═══════════════════════════════════════════════════════════════
// MYSC 2025-2026 KOICA 사업 통합관리 — 참여율 마스터시트 데이터
// 실제 사업 포트폴리오 스프레드시트 기반
// ═══════════════════════════════════════════════════════════════
// NOTE: 이 파일은 Firestore 시딩용 원본 데이터입니다.
// 운영 시 데이터는 Firestore에서 실시간으로 읽어옵니다.
// 하드코딩 데이터 직접 수정 금지 — Firestore를 통해 관리하세요.
// ═══════════════════════════════════════════════════════════════

// ── 프로젝트 정의 (13개 사업) ──

export type ProjectPhaseStatus = '계약전' | '계약완료' | '계약완료(변경진행중)';

export interface ParticipationProject {
  id: string;
  name: string;
  shortName: string;
  clientOrg: string;
  settlement: SettlementSystemCode;
  settlementNote: string;            // e나라도움, 회계사정산, 민간사업
  phase: ProjectPhaseStatus;
  periodDesc: string;                // e.g. "2월-11월, 10개월"
}


// ── 멤버별 요약 통계 ──

/** 인력 명부의 최소 형태. DB(orgs/{org}/persons)에서 온 값을 담는다. */
export interface MyscEmployee {
  id: string;
  realName: string;
  nickname: string;
}


// 로컬 시드 전용. 실제 직원 명부는 DB(orgs/{org}/persons)에 있고, 화면은 그쪽을 본다.
function eid(name: string) { return name; }
function enick(_name: string) { return ''; }

// ── 사업별 참여자 데이터 (스프레드시트 원본) ──

// ── 교차검증 규칙 ──

export const CROSS_VERIFY_RULES: CrossVerifyRule[] = [
  // e나라도움 ↔ R&D 시스템 (가장 강력)
  { systemA: 'E_NARA_DOUM', systemB: 'IRIS', risk: 'HIGH', description: '국고보조금 ↔ R&D 교차검증 (SFDS 실시간 감시)' },
  { systemA: 'E_NARA_DOUM', systemB: 'RCMS', risk: 'HIGH', description: '국고보조금 ↔ 실시간연구비 교차검증 (SFDS)' },
  { systemA: 'E_NARA_DOUM', systemB: 'EZBARO', risk: 'HIGH', description: '국고보조금 ↔ 이지바로 교차검증' },
  // R&D 간
  { systemA: 'IRIS', systemB: 'RCMS', risk: 'HIGH', description: 'R&D 시스템 간 통합 교차검증' },
  { systemA: 'IRIS', systemB: 'EZBARO', risk: 'HIGH', description: 'R&D 시스템 간 교차검증' },
  { systemA: 'RCMS', systemB: 'EZBARO', risk: 'HIGH', description: 'R&D 시스템 간 교차검증' },
  // e나라도움 ↔ 기타
  { systemA: 'E_NARA_DOUM', systemB: 'E_HIJO', risk: 'MEDIUM', description: '국비 ↔ 지방비 매칭사업 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'EDUFINE', risk: 'MEDIUM', description: '국고보조금 ↔ 교육재정 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'HAPPYEUM', risk: 'MEDIUM', description: '국고보조금 ↔ 사회보장 교차검증' },
  { systemA: 'E_NARA_DOUM', systemB: 'AGRIX', risk: 'MEDIUM', description: '국고보조금 ↔ 농림사업 교차검증' },
  // 회계사정산 ↔ e나라도움: 시스템 간 직접 연동은 아니지만 동일기관이면 위험
  { systemA: 'E_NARA_DOUM', systemB: 'ACCOUNTANT', risk: 'LOW', description: '시스템 정산 ↔ 회계사정산 간 직접 교차검증 가능성 낮음 (단, 동일기관 주의)' },
  // 기타
  { systemA: 'RCMS', systemB: 'AGRIX', risk: 'MEDIUM', description: '환경AC ↔ 농식품AC 대면심사 시 참여율 확인 가능' },
];

export function getCrossVerifyRisk(a: SettlementSystemCode, b: SettlementSystemCode): CrossVerifyRule | null {
  if (a === b && a !== 'NONE' && a !== 'PRIVATE') {
    return {
      systemA: a, systemB: b, risk: 'HIGH',
      description: '동일 정산 시스템 내 — 반드시 합산 100% 이내',
    };
  }
  if (a === 'NONE' || b === 'NONE' || a === 'PRIVATE' || b === 'PRIVATE') return null;
  return CROSS_VERIFY_RULES.find(
    r => (r.systemA === a && r.systemB === b) || (r.systemA === b && r.systemB === a)
  ) || null;
}

export interface MemberParticipationSummary {
  memberId: string;
  memberName: string;
  realName: string;
  nickname: string;
  entries: ParticipationEntry[];
  totalRate: number;
  projectCount: number;
  // 정산유형별 합산
  eNaraRate: number;       // e나라도움 합산
  accountantRate: number;  // 회계사정산 합산
  privateRate: number;     // 민간 합산
  // 발주기관별 합산
  orgRates: Record<string, number>;
  // 리스크
  riskLevel: 'SAFE' | 'WARNING' | 'DANGER';
  riskDetails: string[];
  maxVerifiableRate: number;  // 교차검증 가능한 최대 합산
}

export const PARTICIPATION_RISK_RULESET = {
  version: '2026-02-24-rules-v1',
  warningRate: 80,
  limitRate: 100,
  koicaOrgKeywords: ['KOICA', '한국국제협력단'],
} as const;

export interface ParticipationRiskReportRow {
  memberId: string;
  name: string;
  totalRate: number;
  eNaraRate: number;
  accountantRate: number;
  privateRate: number;
  projectCount: number;
  riskLevel: MemberParticipationSummary['riskLevel'];
  risk: string;
  riskDetails: string[];
}

export interface ParticipationRiskReport {
  generatedAt: string;
  rulesetVersion: string;
  thresholds: {
    warningRate: number;
    limitRate: number;
  };
  totalMembers: number;
  rows: ParticipationRiskReportRow[];
}

function orgKey(clientOrg: string): string {
  const raw = (clientOrg || '').split('/')[0]?.trim() || '';
  if (/koica|한국국제협력단/i.test(raw)) return 'KOICA';
  return raw;
}

function isKoicaOrg(org: string): boolean {
  const key = org.toLowerCase();
  return PARTICIPATION_RISK_RULESET.koicaOrgKeywords.some((kw) => key.includes(kw.toLowerCase()));
}

function parseMemberDisplayName(value: string): { realName: string; nickname: string } {
  const text = (value || '').trim();
  const m = text.match(/^(.+?)\((.+)\)$/);
  if (!m) return { realName: text, nickname: '' };
  return {
    realName: m[1].trim(),
    nickname: m[2].trim(),
  };
}

export function computeMemberSummaries(entries: ParticipationEntry[]): MemberParticipationSummary[] {
  // Group by member
  const memberMap = new Map<string, ParticipationEntry[]>();
  entries.forEach(e => {
    const list = memberMap.get(e.memberId) || [];
    list.push(e);
    memberMap.set(e.memberId, list);
  });

  const summaries: MemberParticipationSummary[] = [];

  memberMap.forEach((memberEntries, memberId) => {
    // 같은 사람이라도 사업에 따라 별명 없이 등록된 줄이 있다. 표시 이름은 별명이 있는
    // 줄을 우선한다 - 어느 줄이 먼저 오느냐에 따라 이름이 달라 보이면 안 된다.
    const first = memberEntries.find(e => parseMemberDisplayName(e.memberName).nickname)
      || memberEntries[0];
    const parsedName = parseMemberDisplayName(first.memberName);
    const realName = parsedName.realName || first.memberName;
    const nickname = parsedName.nickname || '';

    // 동일 이름 다중 기간 합산 (같은 사업에 기간별로 다른 참여율인 경우 최대값 사용)
    // → CTS(25~28)의 강민경 10%+15%, 최지윤 20%+80% 같은 경우는 기간이 다르므로 합산
    const projectRateMap = new Map<string, number>();
    memberEntries.forEach(e => {
      const key = e.projectId;
      projectRateMap.set(key, (projectRateMap.get(key) || 0) + e.rate);
    });

    const totalRate = Array.from(projectRateMap.values()).reduce((s, r) => s + r, 0);
    const projectCount = projectRateMap.size;

    // 정산유형별 합산
    let eNaraRate = 0;
    let accountantRate = 0;
    let privateRate = 0;

    // 발주기관별 합산
    const orgRates: Record<string, number> = {};

    memberEntries.forEach(e => {
      if (e.settlementSystem === 'E_NARA_DOUM') eNaraRate += e.rate;
      else if (e.settlementSystem === 'ACCOUNTANT') accountantRate += e.rate;
      else if (e.settlementSystem === 'PRIVATE') privateRate += e.rate;

      const org = orgKey(e.clientOrg);  // "KOICA", "기후에너지환경부" 등
      orgRates[org] = (orgRates[org] || 0) + e.rate;
    });

    // 리스크 분석 (규칙 기반 / deterministic)
    const riskDetails: string[] = [];
    let maxVerifiableRate = 0;
    let dangerByENara = false;
    let dangerByKoica = false;

    // 1) e나라도움 시스템 내 합산
    if (eNaraRate > 0) {
      if (eNaraRate > maxVerifiableRate) maxVerifiableRate = eNaraRate;
      if (eNaraRate > PARTICIPATION_RISK_RULESET.limitRate) {
        dangerByENara = true;
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% → 100% 초과! 즉시 환수 위험`);
      } else if (eNaraRate >= PARTICIPATION_RISK_RULESET.limitRate) {
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% (경고 수준, 추가 배정 주의)`);
      } else if (eNaraRate > PARTICIPATION_RISK_RULESET.warningRate) {
        riskDetails.push(`e나라도움 시스템 합산 ${eNaraRate}% (경고 수준, 추가 배정 주의)`);
      }
    }

    // 2) 동일 발주기관 합산 (KOICA 계열은 위험)
    Object.entries(orgRates).forEach(([org, rate]) => {
      if (rate > maxVerifiableRate) maxVerifiableRate = rate;
      if (rate <= PARTICIPATION_RISK_RULESET.warningRate) return;

      const entriesInOrg = memberEntries.filter(e => orgKey(e.clientOrg) === org);
      const hasVerifiableSettlement = entriesInOrg.some(
        e => e.settlementSystem === 'E_NARA_DOUM' || e.settlementSystem === 'ACCOUNTANT',
      );
      const koicaSensitive = isKoicaOrg(org);

      if (koicaSensitive && hasVerifiableSettlement && rate > PARTICIPATION_RISK_RULESET.limitRate) {
        dangerByKoica = true;
        riskDetails.push(`${org} 발주 사업 합산 ${rate}% → 동일 기관 100% 초과`);
      } else if (hasVerifiableSettlement && rate <= PARTICIPATION_RISK_RULESET.limitRate) {
        const hasENara = entriesInOrg.some(e => e.settlementSystem === 'E_NARA_DOUM');
        if (hasENara) {
          riskDetails.push(`${org} 발주 e나라도움 사업 합산 ${rate}% (경고 수준)`);
        }
      }
    });

    // 3) e나라도움 + 회계사정산 교차 (잠재적)
    if (eNaraRate > 0 && accountantRate > 0) {
      const crossRate = eNaraRate + accountantRate;
      if (crossRate > maxVerifiableRate) maxVerifiableRate = crossRate;
      if (crossRate > PARTICIPATION_RISK_RULESET.limitRate) {
        riskDetails.push(`e나라도움(${eNaraRate}%) + 회계사정산(${accountantRate}%) = ${crossRate}% (교차 잠재 위험)`);
      }
    }

    // 4) 전체 합산 경고
    if (totalRate > 100 && riskDetails.length === 0) {
      riskDetails.push(`전체 합산 ${totalRate}% (교차검증 대상 외 사업 포함)`);
    }

    const riskLevel: MemberParticipationSummary['riskLevel'] =
      (dangerByENara || dangerByKoica) ? 'DANGER'
        : riskDetails.length > 0 ? 'WARNING'
          : 'SAFE';

    summaries.push({
      memberId, memberName: first.memberName,
      realName, nickname,
      entries: memberEntries,
      totalRate, projectCount,
      eNaraRate, accountantRate, privateRate,
      orgRates, riskLevel, riskDetails, maxVerifiableRate,
    });
  });

  // Sort: DANGER first, then WARNING, then SAFE, then by totalRate desc
  return summaries.sort((a, b) => {
    const ro = { DANGER: 0, WARNING: 1, SAFE: 2 };
    if (ro[a.riskLevel] !== ro[b.riskLevel]) return ro[a.riskLevel] - ro[b.riskLevel];
    return b.totalRate - a.totalRate;
  });
}

export function buildParticipationRiskReport(entries: ParticipationEntry[]): ParticipationRiskReport {
  const rows: ParticipationRiskReportRow[] = computeMemberSummaries(entries).map((member) => ({
    memberId: member.memberId,
    name: member.nickname ? `${member.realName}(${member.nickname})` : member.realName,
    totalRate: member.totalRate,
    eNaraRate: member.eNaraRate,
    accountantRate: member.accountantRate,
    privateRate: member.privateRate,
    projectCount: member.projectCount,
    riskLevel: member.riskLevel,
    risk: member.riskDetails[0] || '리스크 없음',
    riskDetails: member.riskDetails,
  }));

  return {
    generatedAt: new Date().toISOString(),
    rulesetVersion: PARTICIPATION_RISK_RULESET.version,
    thresholds: {
      warningRate: PARTICIPATION_RISK_RULESET.warningRate,
      limitRate: PARTICIPATION_RISK_RULESET.limitRate,
    },
    totalMembers: rows.length,
    rows,
  };
}

// ── 교차검증 그룹 계산 ──

export function computeCrossVerifyGroups(entries: ParticipationEntry[]): CrossVerifyGroup[] {
  const memberMap = new Map<string, ParticipationEntry[]>();
  entries.forEach(e => {
    const list = memberMap.get(e.memberId) || [];
    list.push(e);
    memberMap.set(e.memberId, list);
  });

  const groups: CrossVerifyGroup[] = [];
  memberMap.forEach((memberEntries, memberId) => {
    const memberName = memberEntries[0]?.memberName || '';

    // 동일 시스템 그룹
    const systemMap = new Map<SettlementSystemCode, ParticipationEntry[]>();
    memberEntries.forEach(e => {
      if (e.settlementSystem === 'NONE' || e.settlementSystem === 'PRIVATE') return;
      const list = systemMap.get(e.settlementSystem) || [];
      list.push(e);
      systemMap.set(e.settlementSystem, list);
    });
    systemMap.forEach((sysEntries, sysCode) => {
      const totalRate = sysEntries.reduce((s, e) => s + e.rate, 0);
      groups.push({
        memberId, memberName,
        groupKey: `sys:${sysCode}`,
        groupLabel: `${SETTLEMENT_SYSTEM_SHORT[sysCode]} 정산`,
        entries: sysEntries, totalRate,
        risk: totalRate > 100 ? 'HIGH' : totalRate > 80 ? 'MEDIUM' : 'LOW',
        isOverLimit: totalRate > 100,
      });
    });

    // 동일 발주기관 (2건 이상)
    const orgMap = new Map<string, ParticipationEntry[]>();
    memberEntries.forEach(e => {
      if (e.settlementSystem === 'PRIVATE') return;
      const org = e.clientOrg.split('/')[0];
      const list = orgMap.get(org) || [];
      list.push(e);
      orgMap.set(org, list);
    });
    orgMap.forEach((orgEntries, orgName) => {
      if (orgEntries.length < 2) return;
      const totalRate = orgEntries.reduce((s, e) => s + e.rate, 0);
      groups.push({
        memberId, memberName,
        groupKey: `org:${orgName}`,
        groupLabel: `${orgName} (동일기관)`,
        entries: orgEntries, totalRate,
        risk: totalRate > 100 ? 'HIGH' : totalRate > 80 ? 'MEDIUM' : 'LOW',
        isOverLimit: totalRate > 100,
      });
    });
  });

  return groups;
}

