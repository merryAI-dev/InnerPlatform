import { normalizeRole, readOptionalText } from './bff-utils.mjs';
import {
  buildCashflowForecastVariance,
  summarizeCashflowForecastVariance,
} from './cashflow-forecast-variance.mjs';
import { readCashflowCumulativeCloseAuthority } from './cashflow-close-calendar.mjs';
import {
  buildCumulativeCloseHeadPlan,
  buildCumulativeCloseResetToReclosePlan,
} from './cashflow-cumulative-close-head-recovery.mjs';
import {
  assertCashflowPeriodPolicyPersistencePort,
  CashflowPeriodPolicyPersistenceError,
} from './cashflow-period-policy-port.mjs';
import { stableStringify } from './utils.mjs';

const ACTIVE_MEMBER_STATUS = 'ACTIVE';
const ACTIVE_CLOSE_REQUEST_STATUSES = new Set(['PENDING', 'REOPEN_REQUESTED', 'APPROVING', 'UNCERTAIN']);
const YEAR_MONTH_PATTERN = /^20\d{2}-(0[1-9]|1[0-2])$/;
const POSITIVE_STATUSES = new Set(['OK', 'AVAILABLE', 'ACTIVE', 'CLOSED', 'LINKED', 'MATCHED', 'ALIGNED', 'COMPLETE', 'COMPLETED']);
const CRITICAL_STATUSES = new Set(['UNAVAILABLE', 'ERROR', 'INVALID', 'MISMATCH', 'BLOCKED', 'CRITICAL']);
const POLICY_STORE_ISSUES = Object.freeze({
  projects: ['PROJECT_STORE_UNAVAILABLE', 'PROJECT_STORE_TRUNCATED', '프로젝트 저장소 조회 불가'],
  heads: ['CUMULATIVE_CLOSE_HEAD_STORE_UNAVAILABLE', 'CUMULATIVE_CLOSE_HEAD_STORE_TRUNCATED', '누적 마감 권한 저장소 조회 불가'],
  closes: ['MONTHLY_CLOSE_STORE_UNAVAILABLE', 'MONTHLY_CLOSE_STORE_TRUNCATED', '월 결산 확정 저장소 조회 불가'],
  runs: ['MONTHLY_CLOSE_VERSION_STORE_UNAVAILABLE', 'MONTHLY_CLOSE_VERSION_STORE_TRUNCATED', '월 결산 실행 이력 저장소 조회 불가'],
  requests: ['MONTH_CLOSE_REQUEST_STORE_UNAVAILABLE', 'MONTH_CLOSE_REQUEST_STORE_TRUNCATED', '월 결산 요청 저장소 조회 불가'],
  mirrors: ['SHEET_MIRROR_STORE_UNAVAILABLE', 'SHEET_MIRROR_STORE_TRUNCATED', 'Sheet mirror 저장소 조회 불가'],
  completions: ['WEEKLY_COMPLETION_STORE_UNAVAILABLE', 'WEEKLY_COMPLETION_STORE_TRUNCATED', '주간 완료 이력 저장소 조회 불가'],
  amendments: ['CASHFLOW_MONTH_AMENDMENT_STORE_UNAVAILABLE', 'CASHFLOW_MONTH_AMENDMENT_STORE_TRUNCATED', '닫힌 월 수정 이력 저장소 조회 불가'],
  people: ['PEOPLE_STORE_UNAVAILABLE', 'PEOPLE_STORE_TRUNCATED', 'People 저장소 조회 불가'],
  members: ['MEMBER_STORE_UNAVAILABLE', 'MEMBER_STORE_TRUNCATED', '멤버 저장소 조회 불가'],
});

export class CashflowPeriodPolicyApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CashflowPeriodPolicyApplicationError';
    this.code = code;
  }
}

function applicationError(code, message) {
  return new CashflowPeriodPolicyApplicationError(code, message);
}

export function cashflowPeriodPolicyTone(status) {
  const normalized = readOptionalText(status).toUpperCase();
  if (POSITIVE_STATUSES.has(normalized)) return 'positive';
  if (CRITICAL_STATUSES.has(normalized)) return 'critical';
  return 'caution';
}

function withSemanticTones(value) {
  if (Array.isArray(value)) return value.map(withSemanticTones);
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, withSemanticTones(item)]),
  );
  if (typeof result.status === 'string') result.tone = cashflowPeriodPolicyTone(result.status);
  if (typeof result.severity === 'string') result.severityTone = cashflowPeriodPolicyTone(result.severity);
  if (typeof result.identityStatus === 'string') result.identityTone = cashflowPeriodPolicyTone(result.identityStatus);
  if (typeof result.revisionStatus === 'string') result.revisionTone = cashflowPeriodPolicyTone(result.revisionStatus);
  return result;
}

function executiveApproverChangeAction(records, available, projectId) {
  if (!available) {
    return {
      enabled: false,
      status: 'UNAVAILABLE',
      guide: '월 결산 요청 상태를 확인하지 못해 조직장 변경을 잠시 차단했습니다.',
    };
  }
  const locked = records.some((record) => (
    readOptionalText(record.data?.projectId) === projectId
    && ACTIVE_CLOSE_REQUEST_STATUSES.has(readOptionalText(record.data?.status).toUpperCase())
  ));
  return {
    enabled: !locked,
    status: locked ? 'LOCKED' : 'AVAILABLE',
    guide: locked ? '승인 대기 중인 월 결산을 먼저 완료하거나 취소해 주세요.' : '',
  };
}

function readDocumentId(doc) {
  return readOptionalText(doc?.id);
}

function safePositiveRevision(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function timestampIso(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function formatDateTimeLabel(value, missingLabel = '기록 없음') {
  const iso = timestampIso(value);
  return iso || missingLabel;
}

function formatYearMonthLabel(value, suffix = '') {
  const yearMonth = readOptionalText(value);
  if (!YEAR_MONTH_PATTERN.test(yearMonth)) return yearMonth ? '월 형식 오류' : '기록 없음';
  const [year, month] = yearMonth.split('-');
  return `${year}년 ${Number(month)}월${suffix}`;
}

function formatRevisionLabel(value) {
  return Number.isSafeInteger(value) && value >= 0 ? `리비전 ${value}` : '리비전 없음';
}

function revisionValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function personDisplayName(person) {
  const name = readOptionalText(person?.name);
  const nickname = readOptionalText(person?.nickname);
  if (name && nickname && !name.includes(`(${nickname})`)) return `${name}(${nickname})`;
  return name || nickname || '이름 미입력';
}

function issue(code, label, detail, severity = 'WARNING') {
  return { code, severity, label, detail };
}

function policyStore(raw, key) {
  const [unavailableCode, truncatedCode, label] = POLICY_STORE_ISSUES[key];
  const available = raw?.available === true;
  const truncated = available && raw?.truncated === true;
  const issues = [];
  if (!available) {
    issues.push(issue(
      unavailableCode,
      label,
      '현금흐름 정책 정보를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.',
      'ERROR',
    ));
  } else if (truncated) {
    issues.push(issue(
      truncatedCode,
      `${label} 범위 초과`,
      '안전 조회 한도를 넘어 일부만 표시합니다. 누락된 항목은 0이나 정상으로 간주하지 않습니다.',
      'WARNING',
    ));
  }
  return {
    available,
    complete: available && !truncated,
    truncated,
    records: available && Array.isArray(raw.records) ? raw.records : [],
    issues,
  };
}

function indexByProject(records) {
  const indexed = new Map();
  for (const record of records) {
    const projectId = readOptionalText(record.data?.projectId) || record.id;
    if (projectId && !indexed.has(projectId)) indexed.set(projectId, record.data);
  }
  return indexed;
}

function groupByProject(records) {
  const grouped = new Map();
  for (const record of records) {
    const projectId = readOptionalText(record.data?.projectId);
    if (!projectId) continue;
    const values = grouped.get(projectId) || [];
    values.push(record.data);
    grouped.set(projectId, values);
  }
  return grouped;
}

function projectNames(records) {
  const indexed = new Map();
  for (const record of records) {
    const projectId = record.id;
    if (!projectId) continue;
    indexed.set(
      projectId,
      readOptionalText(record.data?.name || record.data?.shortName) || projectId,
    );
  }
  return indexed;
}

function hasCanonicalProjectIdentity(project, projectId) {
  const storedProjectId = readOptionalText(project?.id);
  return !storedProjectId || storedProjectId === projectId;
}

function assertCanonicalProjectIdentity(project, projectId) {
  if (!hasCanonicalProjectIdentity(project, projectId)) {
    throw applicationError(
      'cashflow_project_identity_mismatch',
      '프로젝트 식별자가 저장 경로와 일치하지 않습니다. AXR팀에서 프로젝트 원본을 확인해 주세요.',
    );
  }
}

function buildAmendments(records, storeAvailable, projectNameIndex) {
  if (!storeAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: '닫힌 월 수정 이력 조회 불가',
      rows: [],
    };
  }
  const rows = records.map((record) => {
    const amendment = record.data || {};
    const id = readOptionalText(amendment.id) || record.id;
    const projectId = readOptionalText(amendment.projectId) || null;
    const yearMonth = readOptionalText(amendment.yearMonth) || null;
    const reason = readOptionalText(amendment.reason) || null;
    const actorUid = readOptionalText(amendment.actorUid) || null;
    const actorName = readOptionalText(amendment.actorName) || null;
    const closeRevision = revisionValue(amendment.closeRevision);
    const resultingCloseRevision = revisionValue(amendment.resultingCloseRevision);
    const closeSnapshotHash = readOptionalText(amendment.closeSnapshotHash) || null;
    const sourceRevision = readOptionalText(amendment.sourceRevision) || null;
    const targetRevision = readOptionalText(amendment.targetRevision) || null;
    const resultingTargetRevision = readOptionalText(amendment.resultingTargetRevision) || null;
    const createdAt = timestampIso(amendment.createdAt);
    return {
      id,
      projectId,
      projectName: projectId ? projectNameIndex.get(projectId) || projectId : '프로젝트 미기록',
      yearMonth,
      yearMonthLabel: formatYearMonthLabel(yearMonth),
      reason,
      reasonLabel: reason || '사유 미기록',
      actorUid,
      actorName,
      actorLabel: actorName || (actorUid ? '이름 미기록' : '처리자 미기록'),
      closeRevision,
      closeRevisionLabel: formatRevisionLabel(closeRevision),
      resultingCloseRevision,
      resultingCloseRevisionLabel: formatRevisionLabel(resultingCloseRevision),
      closeSnapshotHash,
      closeSnapshotHashLabel: closeSnapshotHash || '마감 해시 없음',
      sourceRevision,
      sourceRevisionLabel: sourceRevision || 'Source revision 없음',
      targetRevision,
      targetRevisionLabel: targetRevision || 'Target revision 없음',
      resultingTargetRevision,
      resultingTargetRevisionLabel: resultingTargetRevision || 'Resulting target revision 없음',
      createdAt,
      createdAtLabel: formatDateTimeLabel(createdAt, '생성 시각 없음'),
    };
  }).sort((left, right) => {
    if (left.createdAt !== right.createdAt) return (right.createdAt || '').localeCompare(left.createdAt || '');
    return (right.id || '').localeCompare(left.id || '');
  });
  if (rows.length === 0) {
    return { status: 'EMPTY', statusLabel: '닫힌 월 수정 이력 없음', rows };
  }
  const hasIncompleteEvidence = rows.some((row) => (
    !row.id
    || !row.projectId
    || !YEAR_MONTH_PATTERN.test(row.yearMonth || '')
    || !row.reason
    || !row.actorUid
    || row.closeRevision === null
    || row.resultingCloseRevision === null
    || !row.closeSnapshotHash
    || !row.sourceRevision
    || !row.targetRevision
    || !row.resultingTargetRevision
    || !row.createdAt
  ));
  return {
    status: hasIncompleteEvidence ? 'PARTIAL' : 'AVAILABLE',
    statusLabel: hasIncompleteEvidence
      ? `닫힌 월 수정 이력 ${rows.length}건 · 증거 누락 확인 필요`
      : `닫힌 월 수정 이력 ${rows.length}건`,
    rows,
  };
}

function indexMembers(records) {
  const indexed = new Map();
  for (const record of records) {
    const uid = readOptionalText(record.data?.uid);
    if (uid && record.id === uid) indexed.set(uid, { ...record.data, id: record.id, uid });
  }
  return indexed;
}

function indexPeople(records) {
  const indexed = new Map();
  for (const record of records) {
    const uid = readOptionalText(record.data?.uid);
    if (!uid) continue;
    const values = indexed.get(uid) || [];
    values.push({
      ...record.data,
      personId: readOptionalText(record.data?.personId) || record.id,
      uid,
    });
    indexed.set(uid, values);
  }
  return indexed;
}

function resolvePeopleIdentity(uid, peopleIndex, peopleAvailable, memberIndex, membersAvailable) {
  const normalizedUid = readOptionalText(uid);
  if (!normalizedUid) {
    return {
      status: 'UNASSIGNED',
      statusLabel: '미지정',
      uid: null,
      personId: null,
      displayName: '조직장 미지정',
      person: null,
    };
  }
  if (!peopleAvailable || !membersAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: 'People 연결 확인 불가',
      uid: normalizedUid,
      personId: null,
      displayName: 'People UID 확인 불가',
      person: null,
    };
  }
  const matches = peopleIndex.get(normalizedUid) || [];
  if (matches.length === 0) {
    return {
      status: 'UNLINKED',
      statusLabel: 'People UID 연결 필요',
      uid: normalizedUid,
      personId: null,
      displayName: `People UID 연결 필요 (${normalizedUid})`,
      person: null,
    };
  }
  if (matches.length > 1) {
    return {
      status: 'AMBIGUOUS',
      statusLabel: 'People UID 중복',
      uid: normalizedUid,
      personId: null,
      displayName: `People UID 중복 (${normalizedUid})`,
      person: null,
    };
  }
  const person = matches[0];
  const member = memberIndex.get(normalizedUid);
  if (!member || readOptionalText(member.status).toUpperCase() !== ACTIVE_MEMBER_STATUS) {
    return {
      status: 'INACTIVE',
      statusLabel: '활성 멤버 연결 필요',
      uid: normalizedUid,
      personId: person.personId,
      displayName: personDisplayName(person),
      person,
    };
  }
  return {
    status: 'LINKED',
    statusLabel: 'People UID 연결됨',
    uid: normalizedUid,
    personId: person.personId,
    displayName: personDisplayName(person),
    person,
  };
}

function buildAuthority(head, storeAvailable, { tenantId, projectId }) {
  if (!storeAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: '누적 마감 권한 조회 불가',
      closedThrough: null,
      closedThroughLabel: '조회 불가',
      revision: null,
      revisionLabel: '조회 불가',
      rootHash: null,
      rootHashLabel: '조회 불가',
      closedAt: null,
      closedAtLabel: '조회 불가',
    };
  }
  if (!head) {
    return {
      status: 'MISSING',
      statusLabel: '누적 마감 없음',
      closedThrough: null,
      closedThroughLabel: '누적 마감 없음',
      revision: null,
      revisionLabel: '리비전 없음',
      rootHash: null,
      rootHashLabel: '해시 없음',
      closedAt: null,
      closedAtLabel: '마감 기록 없음',
    };
  }
  const authority = readCashflowCumulativeCloseAuthority(head, {
    tenantId,
    projectId,
    allowOpen: true,
  });
  if (!authority) {
    return {
      status: 'INVALID',
      statusLabel: '누적 마감 권한 오류',
      closedThrough: null,
      closedThroughLabel: '계약 오류',
      revision: null,
      revisionLabel: '계약 오류',
      rootHash: null,
      rootHashLabel: '계약 오류',
      closedAt: null,
      closedAtLabel: '계약 오류',
    };
  }
  const { status, closedThrough, revision, rootHash } = authority;
  const closedAt = timestampIso(head.closedAt);
  return {
    status,
    statusLabel: status === 'CLOSED' ? '마감됨' : status === 'OPEN' ? '열림' : `상태 ${status}`,
    closedThrough,
    closedThroughLabel: closedThrough
      ? formatYearMonthLabel(closedThrough, '까지 마감')
      : 'closedThrough 미기록',
    revision,
    revisionLabel: formatRevisionLabel(revision),
    rootHash,
    rootHashLabel: rootHash || '해시 없음',
    closedAt,
    closedAtLabel: formatDateTimeLabel(closedAt, '마감 시간 없음'),
  };
}

function recoveryNextAction(projectId, kind = 'REVIEW_SHEET_AND_RECLOSE') {
  const encodedProjectId = encodeURIComponent(projectId);
  if (kind === 'NORMAL_REOPEN') {
    return {
      type: 'NORMAL_REOPEN',
      label: '프로젝트에서 정상 재오픈',
      href: `/portal/cashflow/${encodedProjectId}`,
    };
  }
  return {
    type: 'REVIEW_SHEET_AND_RECLOSE',
    label: '시트 검증본 다시 검토',
    href: `/portal/cashflow/${encodedProjectId}/sheets-lab`,
  };
}

function buildResetToReclose(resetRow, evidenceAvailable) {
  const cycleCandidates = Array.isArray(resetRow?.cycleCandidates)
    ? resetRow.cycleCandidates.map((candidate) => ({
      yearMonth: candidate.yearMonth,
      yearMonthLabel: formatYearMonthLabel(candidate.yearMonth),
      expectedEvidence: candidate.expectedEvidence,
    }))
    : [];
  if (!evidenceAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: '재결산 준비 근거 조회 불가',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
      warning: null,
      guide: '재결산 준비 근거를 확인하지 못했습니다. 잠시 후 이 화면을 다시 불러와 주세요.',
      cycleCandidates: [],
    };
  }
  if (resetRow?.status === 'RESET_TO_RECLOSE_READY') {
    const preserveMutableHeader = resetRow.preserveMutableHeader === true;
    return {
      status: 'RESET_TO_RECLOSE_READY',
      statusLabel: '격리 후 재결산 준비 가능',
      actionAllowed: true,
      selectionAllowed: false,
      expectedEvidence: resetRow.expectedEvidence,
      warning: preserveMutableHeader
        ? '손상된 누적 authority만 제거하는 되돌리기 어려운 작업입니다. 정상 OPEN/재오픈 진행 header는 보존되고 변경 전 authority는 append-only 감사 사본에 남습니다.'
        : '현재 누적 authority와 선택한 월결산 header를 제거하는 되돌리기 어려운 작업입니다. 변경 전 전체 값은 append-only 감사 사본에 보존됩니다.',
      guide: preserveMutableHeader
        ? `${formatYearMonthLabel(resetRow.yearMonth, ' 회차')}의 정상 mutable header는 유지하고 손상 authority만 감사 격리합니다.`
        : `${formatYearMonthLabel(resetRow.yearMonth, ' 회차')}를 감사 격리한 뒤 시트 검증본 검토와 정상 월결산을 다시 진행합니다. immutable version·request·Sheet 값은 변경하지 않습니다.`,
      cycleCandidates: [],
    };
  }
  if (resetRow?.status === 'RECLOSE_READY') {
    return {
      status: 'RECLOSE_READY',
      statusLabel: '정상 재결산 진행 가능',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
      warning: null,
      guide: '누적 authority와 mutable 월결산 header가 이미 없어 추가 격리가 필요하지 않습니다. 시트 검증본을 확인한 뒤 정상 월결산을 진행해 주세요.',
      cycleCandidates: [],
    };
  }
  if (resetRow?.status === 'NORMAL_REOPEN_REQUIRED') {
    return {
      status: 'NORMAL_REOPEN_REQUIRED',
      statusLabel: '정상 재오픈 사용',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
      warning: null,
      guide: '유효한 누적 마감 권한은 격리하지 않고 정상 재오픈 절차를 사용합니다.',
      cycleCandidates: [],
    };
  }
  if (resetRow?.status === 'EXACT_REPAIR_REQUIRED') {
    return {
      status: 'EXACT_REPAIR_REQUIRED',
      statusLabel: '정확 복구 우선',
      actionAllowed: false,
      selectionAllowed: false,
      expectedEvidence: null,
      warning: null,
      guide: 'immutable evidence가 완전하므로 authority 정확 복구를 먼저 사용합니다.',
      cycleCandidates: [],
    };
  }
  if (resetRow?.status === 'RESET_CYCLE_SELECTION_REQUIRED') {
    return {
      status: 'RESET_CYCLE_SELECTION_REQUIRED',
      statusLabel: '재결산 회차 선택 필요',
      actionAllowed: false,
      selectionAllowed: true,
      expectedEvidence: null,
      warning: '선택한 회차의 현재 mutable header와 손상 authority만 감사 격리합니다. immutable version·request·Sheet 값은 변경하지 않습니다.',
      guide: '서버가 확인한 회차 중 실제로 다시 결산할 회차를 선택해 주세요. 선택한 근거는 실행 직전 transaction에서 다시 검증합니다.',
      cycleCandidates,
    };
  }
  return {
    status: 'UNREPAIRABLE',
    statusLabel: '재결산 준비 범위 확인 필요',
    actionAllowed: false,
    selectionAllowed: false,
    expectedEvidence: null,
    warning: null,
    guide: '격리할 exact 월결산 회차를 확인할 수 없습니다. 최신 정책 상태를 다시 불러와 주세요.',
    cycleCandidates: [],
  };
}

function buildRecovery(planRow, resetRow, evidenceAvailable, projectId) {
  const resetToReclose = buildResetToReclose(resetRow, evidenceAvailable);
  if (planRow?.status === 'AUTHORITY_PRESENT' || resetRow?.status === 'NORMAL_REOPEN_REQUIRED') {
    return {
      status: 'NORMAL_REOPEN_REQUIRED',
      statusLabel: '정상 재오픈 사용',
      actionAllowed: false,
      expectedEvidence: null,
      reasons: [],
      warning: null,
      guide: '유효한 누적 마감 권한입니다. 복구로 덮어쓰지 말고 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
      nextAction: recoveryNextAction(projectId, 'NORMAL_REOPEN'),
      resetToReclose,
    };
  }
  if (!evidenceAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: '복구 근거 조회 불가',
      actionAllowed: false,
      expectedEvidence: null,
      reasons: ['RECOVERY_EVIDENCE_STORE_UNAVAILABLE'],
      warning: null,
      guide: '복구 근거 저장소를 확인하지 못했습니다. 잠시 후 이 화면을 다시 불러와 주세요.',
      nextAction: null,
      resetToReclose,
    };
  }
  if (planRow?.status === 'READY' || planRow?.status === 'REPAIR_READY') {
    return {
      status: planRow.status,
      statusLabel: planRow.status === 'READY' ? '누락 권한 복구 준비 완료' : '손상 권한 복구 준비 완료',
      actionAllowed: true,
      expectedEvidence: planRow.expectedEvidence,
      reasons: planRow.reasons || [],
      warning: '되돌리기 어려운 권한 복구입니다. 현재 head와 복구 후 head의 전체 값은 append-only 감사 사본으로 보존됩니다.',
      guide: planRow.status === 'READY'
        ? '서버가 확정 월결산·버전·요청 증거를 다시 검증한 뒤 누락된 권한만 생성합니다.'
        : '서버가 손상 head를 제외하고 확정 월결산·버전·요청 증거로 canonical head를 다시 계산합니다.',
      nextAction: null,
      resetToReclose,
    };
  }
  return {
    status: 'UNREPAIRABLE',
    statusLabel: '자동 복구 근거 부족',
    actionAllowed: false,
    expectedEvidence: null,
    reasons: planRow?.reasons?.length ? planRow.reasons : ['IMMUTABLE_CLOSE_EVIDENCE_MISSING'],
    warning: null,
    guide: resetToReclose.actionAllowed
      ? '권한 값을 추측해 만들 수 없습니다. 현재 authority와 월결산 header를 감사 격리한 뒤 시트 검증본을 검토하고 정상 월결산으로 immutable close evidence를 다시 생성해 주세요.'
      : '권한 값을 추측해 만들 수 없습니다. 프로젝트의 최신 시트 검증본을 다시 검토·반영한 뒤 정상 월결산으로 immutable close evidence를 다시 생성해 주세요.',
    nextAction: resetToReclose.actionAllowed ? null : recoveryNextAction(projectId),
    resetToReclose,
  };
}

function asPlanDocuments(store) {
  return store.records.map((record) => ({ id: record.id, data: record.data || {} }));
}

function recoveryPlanByProject({ tenantId, closesStore, versionsStore, requestsStore, headsStore }) {
  if (!closesStore.complete || !versionsStore.complete || !requestsStore.complete || !headsStore.complete) {
    return new Map();
  }
  return new Map(buildCumulativeCloseHeadPlan({
    tenantId,
    monthlyCloses: asPlanDocuments(closesStore),
    monthlyCloseVersions: asPlanDocuments(versionsStore),
    requests: asPlanDocuments(requestsStore),
    heads: asPlanDocuments(headsStore),
  }).map((row) => [row.projectId, row]));
}

function resetToReclosePlanByProject({
  tenantId,
  projectIds,
  closesStore,
  versionsStore,
  requestsStore,
  headsStore,
}) {
  if (!closesStore.complete || !versionsStore.complete || !requestsStore.complete || !headsStore.complete) {
    return new Map();
  }
  return new Map(buildCumulativeCloseResetToReclosePlan({
    tenantId,
    projectIds,
    monthlyCloses: asPlanDocuments(closesStore),
    monthlyCloseVersions: asPlanDocuments(versionsStore),
    requests: asPlanDocuments(requestsStore),
    heads: asPlanDocuments(headsStore),
  }).map((row) => [row.projectId, row]));
}

async function readProjectRecoveryPlan(persistencePort, tenantId, projectId) {
  try {
    const evidence = await persistencePort.readProjectRecoveryEvidence({ tenantId, projectId });
    const currentHead = evidence.head.exists ? evidence.head.data || {} : null;
    const [row] = buildCumulativeCloseHeadPlan({
      tenantId,
      monthlyCloses: evidence.monthlyCloses,
      monthlyCloseVersions: evidence.monthlyCloseVersions,
      requests: evidence.requests,
      heads: currentHead ? [{ id: projectId, data: currentHead }] : [],
    });
    return { row: row || null, currentHead };
  } catch {
    throw applicationError(
      'cashflow_close_head_recovery_store_unavailable',
      '누적 마감 복구 근거를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
}

function recoveryOutcomeMatchesExpected(currentEvidence, submittedEvidence) {
  if (
    !currentEvidence || typeof currentEvidence !== 'object' || Array.isArray(currentEvidence)
    || !submittedEvidence || typeof submittedEvidence !== 'object' || Array.isArray(submittedEvidence)
    || currentEvidence.contractVersion !== 'cashflow-cumulative-close-head-recovery-evidence-v1'
    || submittedEvidence.contractVersion !== currentEvidence.contractVersion
  ) return false;
  const { authorityFingerprint: _currentFingerprint, ...currentOutcome } = currentEvidence;
  const { authorityFingerprint: _submittedFingerprint, ...submittedOutcome } = submittedEvidence;
  return stableStringify(currentOutcome) === stableStringify(submittedOutcome);
}

async function readProjectResetToReclosePlan(persistencePort, tenantId, projectId, expectedEvidence) {
  const yearMonth = readOptionalText(expectedEvidence?.yearMonth);
  const monthlyCloseId = readOptionalText(expectedEvidence?.monthlyCloseId);
  if (!YEAR_MONTH_PATTERN.test(yearMonth) || monthlyCloseId !== `${projectId}-${yearMonth}`) {
    throw applicationError(
      'cashflow_close_reset_to_reclose_payload_invalid',
      '화면에서 확인한 재결산 회차 근거가 올바르지 않습니다. 화면을 다시 불러와 주세요.',
    );
  }
  try {
    const evidence = await persistencePort.readProjectResetEvidence({
      tenantId,
      projectId,
      monthlyCloseId,
    });
    const [row] = buildCumulativeCloseResetToReclosePlan({
      tenantId,
      projectIds: [projectId],
      monthlyCloses: evidence.monthlyClose.exists
        ? [{ id: monthlyCloseId, data: evidence.monthlyClose.data || {} }]
        : [],
      monthlyCloseVersions: evidence.monthlyCloseVersions,
      requests: evidence.requests,
      heads: evidence.head.exists ? [{ id: projectId, data: evidence.head.data || {} }] : [],
    });
    if (row?.status === 'RESET_CYCLE_SELECTION_REQUIRED') {
      const selected = row.cycleCandidates?.find((candidate) => (
        stableStringify(candidate.expectedEvidence) === stableStringify(expectedEvidence)
      ));
      if (selected) {
        return {
          ...row,
          status: 'RESET_TO_RECLOSE_READY',
          monthlyCloseId: selected.monthlyCloseId,
          yearMonth: selected.yearMonth,
          expectedEvidence: selected.expectedEvidence,
        };
      }
    }
    return row || null;
  } catch (error) {
    if (error instanceof CashflowPeriodPolicyApplicationError) throw error;
    throw applicationError(
      'cashflow_close_reset_to_reclose_store_unavailable',
      '재결산 준비 근거를 확인하지 못했습니다. 잠시 후 이 화면을 다시 불러와 주세요.',
    );
  }
}

function latestMonthlyRun(records, projectId) {
  return records
    .filter((record) => readOptionalText(record.data?.projectId) === projectId)
    .sort((left, right) => {
      const leftData = left.data || {};
      const rightData = right.data || {};
      const leftTime = timestampIso(leftData.closedAt || leftData.updatedAt || leftData.createdAt) || '';
      const rightTime = timestampIso(rightData.closedAt || rightData.updatedAt || rightData.createdAt) || '';
      if (leftTime !== rightTime) return rightTime.localeCompare(leftTime);
      const monthOrder = readOptionalText(rightData.yearMonth).localeCompare(readOptionalText(leftData.yearMonth));
      if (monthOrder !== 0) return monthOrder;
      return safePositiveRevision(rightData.revision) - safePositiveRevision(leftData.revision);
    })[0]?.data || null;
}

function buildLatestRun(run, storeAvailable, peopleIndex, peopleAvailable, memberIndex, membersAvailable) {
  if (!storeAvailable) {
    return {
      status: 'UNAVAILABLE', statusLabel: '월 결산 실행 이력 조회 불가',
      yearMonth: null, yearMonthLabel: '조회 불가', revision: null, revisionLabel: '조회 불가',
      closedAt: null, closedAtLabel: '조회 불가', closedByUid: null, closedByLabel: '조회 불가',
    };
  }
  if (!run) {
    return {
      status: 'MISSING', statusLabel: '월 결산 실행 이력 없음',
      yearMonth: null, yearMonthLabel: '실행 이력 없음', revision: null, revisionLabel: '리비전 없음',
      closedAt: null, closedAtLabel: '실행 이력 없음', closedByUid: null, closedByLabel: '실행자 없음',
    };
  }
  const status = readOptionalText(run.status).toUpperCase() || 'UNKNOWN';
  const yearMonth = readOptionalText(run.yearMonth) || null;
  const revision = Number.isSafeInteger(run.revision) ? run.revision : null;
  const closedAt = timestampIso(run.closedAt || run.updatedAt || run.createdAt);
  const closedByUid = readOptionalText(run.closedByUid) || null;
  const closedBy = resolvePeopleIdentity(
    closedByUid,
    peopleIndex,
    peopleAvailable,
    memberIndex,
    membersAvailable,
  );
  return {
    status,
    statusLabel: status === 'CLOSED' ? '마감 실행 완료' : `실행 상태 ${status}`,
    yearMonth,
    yearMonthLabel: formatYearMonthLabel(yearMonth),
    revision,
    revisionLabel: formatRevisionLabel(revision),
    closedAt,
    closedAtLabel: formatDateTimeLabel(closedAt, '실행 시간 없음'),
    closedByUid,
    closedByLabel: closedByUid ? closedBy.displayName : '실행자 없음',
  };
}

function buildSheet(mirror, storeAvailable) {
  if (!storeAvailable) {
    return {
      status: 'UNAVAILABLE', statusLabel: 'Sheet mirror 조회 불가',
      weeklyYear: null, weeklyYearLabel: '조회 불가', annualYears: [], annualYearsLabel: '조회 불가',
      sourceRevision: null, sourceRevisionLabel: '조회 불가',
      appliedSourceRevision: null, appliedSourceRevisionLabel: '조회 불가',
      targetRevisionAtFetch: null, targetRevisionAtFetchLabel: '조회 불가',
      appliedTargetRevision: null, appliedTargetRevisionLabel: '조회 불가',
      revisionStatus: 'UNAVAILABLE', revisionStatusLabel: '리비전 조회 불가',
      capturedAt: null, capturedAtLabel: '조회 불가',
    };
  }
  if (!mirror) {
    return {
      status: 'MISSING', statusLabel: 'Sheet mirror 없음',
      weeklyYear: null, weeklyYearLabel: '주차형 계약 없음', annualYears: [], annualYearsLabel: '연간형 계약 없음',
      sourceRevision: null, sourceRevisionLabel: '원본 리비전 없음',
      appliedSourceRevision: null, appliedSourceRevisionLabel: '반영 리비전 없음',
      targetRevisionAtFetch: null, targetRevisionAtFetchLabel: '대상 리비전 없음',
      appliedTargetRevision: null, appliedTargetRevisionLabel: '반영 대상 리비전 없음',
      revisionStatus: 'MISSING', revisionStatusLabel: '리비전 없음',
      capturedAt: null, capturedAtLabel: '수집 기록 없음',
    };
  }
  const status = readOptionalText(mirror.status).toUpperCase() || 'UNKNOWN';
  const weeklyYearValue = Number(mirror?.sheetContract?.weeklyYear ?? mirror?.weeklyYear);
  const weeklyYear = Number.isSafeInteger(weeklyYearValue) ? weeklyYearValue : null;
  const annualYears = Array.from(new Set(
    (Array.isArray(mirror?.sheetContract?.annualYears) ? mirror.sheetContract.annualYears : [])
      .map(Number)
      .filter(Number.isSafeInteger),
  )).sort((left, right) => left - right);
  const sourceRevision = readOptionalText(mirror.sourceRevision) || null;
  const appliedSourceRevision = readOptionalText(mirror.appliedSourceRevision) || null;
  const targetRevisionAtFetch = readOptionalText(mirror.targetRevisionAtFetch) || null;
  const appliedTargetRevision = readOptionalText(mirror.appliedTargetRevision) || null;
  let revisionStatus = 'ALIGNED';
  let revisionStatusLabel = 'Source/target 리비전 일치';
  if (!sourceRevision) {
    revisionStatus = 'SOURCE_MISSING';
    revisionStatusLabel = '원본 리비전 없음';
  } else if (!appliedSourceRevision) {
    revisionStatus = 'SOURCE_NOT_APPLIED';
    revisionStatusLabel = '원본 미반영';
  } else if (sourceRevision !== appliedSourceRevision) {
    revisionStatus = 'SOURCE_DRIFT';
    revisionStatusLabel = '원본·반영 리비전 불일치';
  } else if (!targetRevisionAtFetch) {
    revisionStatus = 'TARGET_MISSING';
    revisionStatusLabel = '대상 리비전 없음';
  } else if (!appliedTargetRevision) {
    revisionStatus = 'TARGET_NOT_APPLIED';
    revisionStatusLabel = '대상 리비전 미반영';
  } else if (targetRevisionAtFetch !== appliedTargetRevision) {
    revisionStatus = 'TARGET_DRIFT';
    revisionStatusLabel = '대상·반영 대상 리비전 불일치';
  }
  const capturedAt = timestampIso(mirror.capturedAt);
  return {
    status,
    statusLabel: status === 'FRESH' ? '최신 mirror' : status === 'STALE' ? '갱신 필요' : `Mirror 상태 ${status}`,
    weeklyYear,
    weeklyYearLabel: weeklyYear ? `${weeklyYear}년 주차형` : '주차형 계약 없음',
    annualYears,
    annualYearsLabel: annualYears.length > 0
      ? `${annualYears.map((year) => `${year}년`).join(', ')} 연간형`
      : '연간형 계약 없음',
    sourceRevision,
    sourceRevisionLabel: sourceRevision || '원본 리비전 없음',
    appliedSourceRevision,
    appliedSourceRevisionLabel: appliedSourceRevision || '반영 리비전 없음',
    targetRevisionAtFetch,
    targetRevisionAtFetchLabel: targetRevisionAtFetch || '대상 리비전 없음',
    appliedTargetRevision,
    appliedTargetRevisionLabel: appliedTargetRevision || '반영 대상 리비전 없음',
    revisionStatus,
    revisionStatusLabel,
    capturedAt,
    capturedAtLabel: formatDateTimeLabel(capturedAt, '수집 기록 없음'),
  };
}

function buildSheetRevisionIssue(projectId, revisionStatus) {
  const issues = {
    SOURCE_MISSING: [
      'SHEET_SOURCE_REVISION_MISSING',
      'Sheet 원본 리비전 없음',
      `${projectId}의 sourceRevision이 없습니다.`,
    ],
    SOURCE_NOT_APPLIED: [
      'SHEET_SOURCE_REVISION_NOT_APPLIED',
      'Sheet 원본 미반영',
      `${projectId}의 appliedSourceRevision이 없습니다.`,
    ],
    SOURCE_DRIFT: [
      'SHEET_SOURCE_REVISION_DRIFT',
      'Sheet 원본·반영 리비전 불일치',
      `${projectId}의 sourceRevision과 appliedSourceRevision이 다릅니다.`,
    ],
    TARGET_MISSING: [
      'SHEET_TARGET_REVISION_MISSING',
      'Sheet 대상 리비전 없음',
      `${projectId}의 targetRevisionAtFetch가 없습니다.`,
    ],
    TARGET_NOT_APPLIED: [
      'SHEET_TARGET_REVISION_NOT_APPLIED',
      'Sheet 대상 리비전 미반영',
      `${projectId}의 appliedTargetRevision이 없습니다.`,
    ],
    TARGET_DRIFT: [
      'SHEET_TARGET_REVISION_DRIFT',
      'Sheet 대상·반영 대상 리비전 불일치',
      `${projectId}의 targetRevisionAtFetch와 appliedTargetRevision이 다릅니다.`,
    ],
  };
  const values = issues[revisionStatus];
  return values ? issue(values[0], values[1], values[2], 'WARNING') : null;
}

function buildExecutiveApprover(identity, projectVersion, changeAction = {
  enabled: true,
  status: 'AVAILABLE',
  guide: '',
}) {
  const expectedVersion = safePositiveRevision(projectVersion);
  return {
    status: identity.status,
    statusLabel: identity.statusLabel,
    uid: identity.uid,
    personId: identity.personId,
    displayName: identity.displayName,
    expectedVersion,
    expectedVersionLabel: `프로젝트 리비전 ${expectedVersion}`,
    changeAction,
  };
}

function buildIdentityIssue(projectId, identity) {
  if (identity.status === 'UNLINKED') {
    return issue(
      'EXECUTIVE_APPROVER_PEOPLE_UID_UNLINKED',
      '조직장 People UID 연결 필요',
      `${projectId}의 executiveApproverId가 People 명부와 연결되지 않았습니다.`,
      'ERROR',
    );
  }
  if (identity.status === 'AMBIGUOUS') {
    return issue(
      'EXECUTIVE_APPROVER_PEOPLE_UID_AMBIGUOUS',
      '조직장 People UID 중복',
      `${projectId}의 executiveApproverId에 둘 이상의 People 레코드가 연결되어 있습니다.`,
      'ERROR',
    );
  }
  if (identity.status === 'INACTIVE') {
    return issue(
      'EXECUTIVE_APPROVER_MEMBER_INACTIVE',
      '조직장 활성 멤버 연결 필요',
      `${projectId}의 조직장 People UID에 활성 멤버가 없습니다.`,
      'ERROR',
    );
  }
  return null;
}

async function assertRuntimeSuperadmin(persistencePort, tenantId, actorId) {
  try {
    await persistencePort.assertRuntimeSuperadmin({ tenantId, actorId });
  } catch (error) {
    if (
      error instanceof CashflowPeriodPolicyPersistenceError
      && error.code === 'RUNTIME_SUPERADMIN_REQUIRED'
    ) {
      throw applicationError(
        'runtime_superadmin_required',
        'People UID가 정확히 연결된 ACTIVE runtime admin 권한이 필요합니다.',
      );
    }
    throw applicationError(
      'runtime_superadmin_store_unavailable',
      'Runtime superadmin 권한 저장소를 확인할 수 없습니다.',
    );
  }
}

function buildRuntimeSuperadmins(memberIndex, membersAvailable, peopleIndex, peopleAvailable) {
  if (!membersAvailable || !peopleAvailable) {
    return {
      status: 'UNAVAILABLE',
      statusLabel: 'Runtime superadmin 조회 불가',
      items: [],
    };
  }
  const items = [...memberIndex.values()]
    .map((member) => ({
      uid: readOptionalText(member.uid),
      role: normalizeRole(member.role),
      status: readOptionalText(member.status).toUpperCase(),
    }))
    .filter((member) => (
      member.uid
      && member.role === 'admin'
      && member.status === ACTIVE_MEMBER_STATUS
    ))
    .map((member) => {
      const matches = peopleIndex.get(member.uid) || [];
      if (matches.length !== 1) {
        return {
          uid: member.uid,
          personId: null,
          displayName: matches.length > 1 ? 'People UID 중복' : 'People UID 연결 필요',
          identityStatus: matches.length > 1 ? 'AMBIGUOUS' : 'UNLINKED',
          identityStatusLabel: matches.length > 1 ? 'People UID 중복' : 'People UID 연결 필요',
        };
      }
      return {
        uid: member.uid,
        personId: matches[0].personId,
        displayName: personDisplayName(matches[0]),
        identityStatus: 'LINKED',
        identityStatusLabel: 'People UID 연결됨',
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ko'));
  return { status: 'AVAILABLE', statusLabel: 'Runtime member.role=admin 기준', items };
}

function buildExecutiveApproverCandidates(peopleIndex, peopleAvailable, memberIndex, membersAvailable) {
  if (!peopleAvailable || !membersAvailable) {
    return { status: 'UNAVAILABLE', statusLabel: '조직장 후보 조회 불가', items: [] };
  }
  const items = [];
  for (const [uid, matches] of peopleIndex) {
    const member = memberIndex.get(uid);
    if (
      matches.length !== 1
      || !member
      || readOptionalText(member.status).toUpperCase() !== ACTIVE_MEMBER_STATUS
    ) continue;
    items.push({ uid, personId: matches[0].personId, displayName: personDisplayName(matches[0]) });
  }
  items.sort((left, right) => left.displayName.localeCompare(right.displayName, 'ko'));
  return { status: 'AVAILABLE', statusLabel: 'People UID 연결 활성 멤버', items };
}

export function createCashflowPeriodPolicyService({
  persistencePort,
  now,
}) {
  const port = assertCashflowPeriodPolicyPersistencePort(persistencePort);
  return {
    async readPolicy({ tenantId, actorId }) {
    await assertRuntimeSuperadmin(port, tenantId, actorId);

    const evidence = await port.readPolicyEvidence({ tenantId });
    const projectsStore = policyStore(evidence.projects, 'projects');
    const headsStore = policyStore(evidence.heads, 'heads');
    const closesStore = policyStore(evidence.closes, 'closes');
    const runsStore = policyStore(evidence.runs, 'runs');
    const requestsStore = policyStore(evidence.requests, 'requests');
    const mirrorsStore = policyStore(evidence.mirrors, 'mirrors');
    const completionsStore = policyStore(evidence.completions, 'completions');
    const amendmentsStore = policyStore(evidence.amendments, 'amendments');
    const peopleStore = policyStore(evidence.people, 'people');
    const membersStore = policyStore(evidence.members, 'members');

    const stores = [
      projectsStore,
      headsStore,
      closesStore,
      runsStore,
      requestsStore,
      mirrorsStore,
      completionsStore,
      amendmentsStore,
      peopleStore,
      membersStore,
    ];
    const topIssues = stores.flatMap((store) => store.issues);
    const headIndex = new Map(headsStore.records.map((record) => [record.id, record.data]));
    const recoveryPlans = recoveryPlanByProject({
      tenantId,
      closesStore,
      versionsStore: runsStore,
      requestsStore,
      headsStore,
    });
    const resetToReclosePlans = resetToReclosePlanByProject({
      tenantId,
      projectIds: projectsStore.records.map((record) => record.id),
      closesStore,
      versionsStore: runsStore,
      requestsStore,
      headsStore,
    });
    const recoveryEvidenceAvailable = closesStore.complete
      && runsStore.complete
      && requestsStore.complete
      && headsStore.complete;
    const mirrorIndex = indexByProject(mirrorsStore.records);
    const completionsByProject = groupByProject(completionsStore.records);
    const peopleIndex = indexPeople(peopleStore.records);
    const memberIndex = indexMembers(membersStore.records);
    const amendments = buildAmendments(
      amendmentsStore.records,
      amendmentsStore.complete,
      projectNames(projectsStore.records),
    );
    const superadmins = buildRuntimeSuperadmins(
      memberIndex,
      membersStore.complete,
      peopleIndex,
      peopleStore.complete,
    );
    const executiveApproverCandidates = buildExecutiveApproverCandidates(
      peopleIndex,
      peopleStore.complete,
      memberIndex,
      membersStore.complete,
    );

    const items = projectsStore.available
      ? projectsStore.records
        .filter((record) => !record.data?.trashedAt && !record.data?.deletedAt)
        .map((record) => {
          const project = record.data || {};
          const projectId = record.id;
          const projectIdentityMismatch = !hasCanonicalProjectIdentity(project, projectId);
          const projectName = readOptionalText(project.name || project.shortName) || projectId;
          const authority = projectIdentityMismatch
            ? buildAuthority({}, true, { tenantId, projectId })
            : buildAuthority(headIndex.get(projectId), headsStore.complete, { tenantId, projectId });
          const recovery = projectIdentityMismatch
            ? buildRecovery(null, null, false, projectId)
            : buildRecovery(
              recoveryPlans.get(projectId),
              resetToReclosePlans.get(projectId),
              recoveryEvidenceAvailable,
              projectId,
            );
          const latestRun = buildLatestRun(
            latestMonthlyRun(runsStore.records, projectId),
            runsStore.complete,
            peopleIndex,
            peopleStore.complete,
            memberIndex,
            membersStore.complete,
          );
          const mirror = mirrorIndex.get(projectId);
          const sheet = buildSheet(mirror, mirrorsStore.complete);
          const forecastVariance = buildCashflowForecastVariance({
            projectId,
            completions: (completionsByProject.get(projectId) || []).filter(
              (completion) => readOptionalText(completion?.status).toUpperCase() === 'LOCKED',
            ),
            mirror,
            completionsAvailable: completionsStore.complete,
            mirrorAvailable: mirrorsStore.complete,
          });
          const approverIdentity = resolvePeopleIdentity(
            project.executiveApproverId,
            peopleIndex,
            peopleStore.complete,
            memberIndex,
            membersStore.complete,
          );
          const itemIssues = [];
          if (projectIdentityMismatch) {
            itemIssues.push(issue(
              'PROJECT_IDENTITY_MISMATCH',
              '프로젝트 식별자 불일치',
              `${projectId}의 저장 경로와 프로젝트 원본 ID가 일치하지 않습니다. 관련 변경은 차단되었습니다.`,
              'ERROR',
            ));
          }
          const identityProblem = buildIdentityIssue(projectId, approverIdentity);
          if (identityProblem) itemIssues.push(identityProblem);
          if (authority.status === 'INVALID') {
            itemIssues.push(issue(
              'CUMULATIVE_CLOSE_HEAD_CONTRACT_INVALID',
              '누적 마감 권한 계약 오류',
              `${projectId}의 누적 마감 head가 공통 권한 계약을 위반했습니다.`,
              'ERROR',
            ));
          }
          if (authority.status === 'MISSING' && latestRun.status === 'CLOSED') {
            itemIssues.push(issue(
              'LATEST_RUN_WITHOUT_CUMULATIVE_HEAD',
              '월 결산 이력과 누적 마감 권한 불일치',
              `${projectId}에 CLOSED 실행 이력은 있지만 closedThrough 권한 head가 없습니다.`,
              'ERROR',
            ));
          }
          const revisionProblem = buildSheetRevisionIssue(projectId, sheet.revisionStatus);
          if (revisionProblem) itemIssues.push(revisionProblem);
          return {
            project: {
              id: projectId,
              name: projectName,
              status: readOptionalText(project.status) || 'UNKNOWN',
              statusLabel: readOptionalText(project.status) || '상태 미입력',
            },
            authority,
            recovery,
            latestRun,
            sheet,
            executiveApprover: buildExecutiveApprover(
              approverIdentity,
              project.version,
              executiveApproverChangeAction(requestsStore.records, requestsStore.complete, projectId),
            ),
            forecastVariance,
            issues: itemIssues,
          };
        })
        .sort((left, right) => left.project.name.localeCompare(right.project.name, 'ko'))
      : [];
    const forecastVariance = summarizeCashflowForecastVariance(
      items.map((item) => item.forecastVariance),
    );

    const hasItemIssues = items.some((item) => item.issues.length > 0);
    const hasSuperadminIdentityIssue = superadmins.items.some((item) => item.identityStatus !== 'LINKED');
    const hasAmendmentIssue = amendments.status === 'PARTIAL' || amendments.status === 'UNAVAILABLE';
    const status = !projectsStore.available
      ? 'UNAVAILABLE'
      : topIssues.length > 0 || hasItemIssues || hasSuperadminIdentityIssue || hasAmendmentIssue
        ? 'PARTIAL'
        : 'OK';
    const generatedAt = timestampIso(now());
    return withSemanticTones({
      status,
      statusLabel: status === 'OK' ? '정상' : status === 'PARTIAL' ? '확인 필요' : '조회 불가',
      generatedAt,
      generatedAtLabel: formatDateTimeLabel(generatedAt, '생성 시간 없음'),
      issues: topIssues,
      superadmins,
      executiveApproverCandidates,
      amendments,
      forecastVariance,
      items,
    });
    },

    async updateExecutiveApprover({
      tenantId,
      actorId,
      requestId,
      projectId,
      approverUid,
      expectedVersion,
      reason,
    }) {
      const timestamp = timestampIso(now());
      let result;
      try {
        result = await port.transactExecutiveApproverChange({
          tenantId,
          actorId,
          projectId,
          approverUid,
          decide: async ({ project: projectRecord, member: memberRecord, people, pendingRequests }) => {
            if (!projectRecord.exists) {
              throw applicationError('not_found', '프로젝트를 찾을 수 없습니다.');
            }
            const member = memberRecord.exists ? memberRecord.data || {} : null;
            if (
              !member
              || readOptionalText(member.uid) !== approverUid
              || readOptionalText(member.status).toUpperCase() !== ACTIVE_MEMBER_STATUS
            ) {
              throw applicationError(
                'cashflow_executive_approver_member_inactive',
                'People UID와 같은 활성 멤버가 필요합니다.',
              );
            }
            if (people.length === 0) {
              throw applicationError(
                'cashflow_executive_approver_people_uid_unlinked',
                '선택한 UID가 People 명부와 연결되지 않았습니다.',
              );
            }
            if (people.length > 1) {
              throw applicationError(
                'cashflow_executive_approver_people_uid_ambiguous',
                '선택한 UID가 둘 이상의 People 레코드와 연결되어 있습니다.',
              );
            }
            const changeAction = executiveApproverChangeAction(pendingRequests, true, projectId);
            if (!changeAction.enabled) {
              throw applicationError(
                'cashflow_executive_approver_locked',
                '승인 대기 중인 월 결산이 있어 조직장을 변경할 수 없습니다.',
              );
            }

            const project = projectRecord.data || {};
            assertCanonicalProjectIdentity(project, projectId);
            const currentVersion = safePositiveRevision(project.version);
            if (expectedVersion !== currentVersion) {
              throw applicationError(
                'version_conflict',
                '프로젝트 정보가 변경되었습니다. 새로고침 후 다시 지정해 주세요.',
              );
            }
            const personRecord = people[0];
            const person = {
              ...(personRecord.data || {}),
              personId: readOptionalText(personRecord.data?.personId) || personRecord.id,
              uid: approverUid,
            };
            if (readOptionalText(project.executiveApproverId) === approverUid) {
              return {
                changed: false,
                project,
                person,
                version: currentVersion,
                auditEntries: [],
                projectPatch: null,
              };
            }

            const nextVersion = currentVersion + 1;
            const previousApproverUid = readOptionalText(project.executiveApproverId) || null;
            return {
              changed: true,
              project,
              person,
              version: nextVersion,
              auditEntries: [{
                tenantId,
                entityType: 'project',
                entityId: projectId,
                action: 'EXECUTIVE_APPROVER_CHANGE',
                actorId,
                actorRole: 'admin',
                requestId,
                details: `현금흐름 조직장 People UID 변경: ${previousApproverUid || '미지정'} -> ${approverUid}`,
                metadata: {
                  source: 'cashflow_period_policy',
                  previousApproverUid,
                  nextApproverUid: approverUid,
                  reason: reason || null,
                  previousVersion: currentVersion,
                  nextVersion,
                },
                timestamp,
              }],
              projectPatch: {
                executiveApproverId: approverUid,
                version: nextVersion,
                updatedAt: timestamp,
                updatedBy: actorId,
              },
            };
          },
        });
      } catch (error) {
        if (!(error instanceof CashflowPeriodPolicyPersistenceError)) throw error;
        if (error.code === 'RUNTIME_SUPERADMIN_REQUIRED') {
          throw applicationError(
            'runtime_superadmin_required',
            'People UID가 정확히 연결된 ACTIVE runtime admin 권한이 필요합니다.',
          );
        }
        throw applicationError(
          'cashflow_executive_approver_store_unavailable',
          '조직장 변경 근거를 안전하게 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }

      const identity = {
        status: 'LINKED',
        statusLabel: 'People UID 연결됨',
        uid: approverUid,
        personId: result.person.personId,
        displayName: personDisplayName(result.person),
      };
      return {
        projectId,
        changed: result.changed,
        executiveApprover: withSemanticTones(buildExecutiveApprover(identity, result.version)),
        updatedAt: result.changed ? timestamp : timestampIso(result.project.updatedAt),
        updatedAtLabel: formatDateTimeLabel(
          result.changed ? timestamp : result.project.updatedAt,
          '변경 시간 없음',
        ),
      };
    },

    async recoverCumulativeCloseHead({ tenantId, actorId, projectId, reason, expectedEvidence }) {

      await assertRuntimeSuperadmin(port, tenantId, actorId);
      let projectRecord;
      try {
        projectRecord = await port.readProject({ tenantId, projectId });
      } catch {
        throw applicationError(
          'cashflow_close_head_recovery_store_unavailable',
          '복구할 프로젝트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      if (!projectRecord.exists) {
        throw applicationError('not_found', '복구할 프로젝트를 찾을 수 없습니다.');
      }
      assertCanonicalProjectIdentity(projectRecord.data || {}, projectId);

      const current = await readProjectRecoveryPlan(port, tenantId, projectId);
      if (current.row?.status === 'AUTHORITY_PRESENT') {
        if (recoveryOutcomeMatchesExpected(current.row.expectedEvidence, expectedEvidence)) {
          return {
            projectId,
            status: 'REPLAYED',
            statusLabel: '이미 같은 근거로 복구됨',
            recoveryAction: 'VERIFIED',
            changed: false,
            replayed: true,
            guide: '같은 원본 근거로 canonical 누적 마감 권한이 이미 복구되어 있습니다. 이후 변경이 필요하면 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
          };
        }
        throw applicationError(
          'cashflow_close_head_recovery_normal_reopen_required',
          '이미 유효한 누적 마감 권한입니다. 복구로 덮어쓰지 말고 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
        );
      }
      if (!current.row || current.row.status === 'UNREPAIRABLE') {
        throw applicationError(
          'cashflow_close_head_recovery_unrepairable',
          '자동 복구에 필요한 immutable close evidence가 완전하지 않습니다. 프로젝트의 최신 시트 검증본을 다시 검토·반영한 뒤 정상 월결산으로 증거를 다시 생성해 주세요.',
        );
      }
      if (!['READY', 'REPAIR_READY'].includes(current.row.status)) {
        throw applicationError(
          'cashflow_close_head_recovery_not_ready',
          '현재 상태에서는 권한 복구를 실행할 수 없습니다. 이 화면을 다시 불러와 상태를 확인해 주세요.',
        );
      }
      if (stableStringify(expectedEvidence) !== stableStringify(current.row.expectedEvidence)) {
        throw applicationError(
          'cashflow_close_head_recovery_evidence_changed',
          '복구 근거가 변경되었습니다. 이 화면을 다시 불러온 뒤 최신 근거로 다시 시도해 주세요.',
        );
      }

      let result;
      try {
        result = await port.applyCumulativeCloseHeadRecovery({
          tenantId,
          plan: [current.row],
          options: {
            apply: true,
            allowedProjectIds: [projectId],
            peopleUid: actorId,
            reason,
            tenantId,
          },
        });
      } catch (error) {
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RUNTIME_SUPERADMIN_REQUIRED'
        ) {
          throw applicationError(
            'runtime_superadmin_required',
            'People UID가 연결된 ACTIVE runtime admin 권한이 필요합니다.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RECOVERY_EVIDENCE_CHANGED'
        ) {
          throw applicationError(
            'cashflow_close_head_recovery_evidence_changed',
            '복구 중 원본 근거가 변경되었습니다. 이 화면을 다시 불러온 뒤 최신 근거로 다시 시도해 주세요.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RECOVERY_EVIDENCE_TRUNCATED'
        ) {
          throw applicationError(
            'cashflow_close_head_recovery_store_unavailable',
            '복구 근거가 안전 조회 범위를 초과했습니다. AXR팀에서 프로젝트 근거 범위를 확인해 주세요.',
          );
        }
        throw applicationError(
          'cashflow_close_head_recovery_unavailable',
          '누적 마감 권한 복구를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속되면 AXR팀에 프로젝트 ID와 함께 알려 주세요.',
        );
      }

      const changed = result.applied.includes(projectId);
      const replayed = result.replayed.includes(projectId);
      return {
        projectId,
        status: changed ? 'RECOVERED' : 'REPLAYED',
        statusLabel: changed ? '누적 마감 권한 복구 완료' : '이미 같은 근거로 복구됨',
        recoveryAction: current.row.status === 'REPAIR_READY' ? 'REPAIRED' : 'BACKFILLED',
        changed,
        replayed,
        guide: '복구 후 정책 상태를 다시 불러왔습니다. 이후 변경이 필요하면 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
      };
    },

    async resetCumulativeCloseToReclose({ tenantId, actorId, projectId, reason, expectedEvidence }) {

      await assertRuntimeSuperadmin(port, tenantId, actorId);
      let projectRecord;
      try {
        projectRecord = await port.readProject({ tenantId, projectId });
      } catch {
        throw applicationError(
          'cashflow_close_reset_to_reclose_store_unavailable',
          '재결산할 프로젝트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
      if (!projectRecord.exists) {
        throw applicationError('not_found', '재결산을 준비할 프로젝트를 찾을 수 없습니다.');
      }
      assertCanonicalProjectIdentity(projectRecord.data || {}, projectId);

      const current = await readProjectResetToReclosePlan(
        port,
        tenantId,
        projectId,
        expectedEvidence,
      );
      if (current?.status === 'NORMAL_REOPEN_REQUIRED') {
        throw applicationError(
          'cashflow_close_reset_to_reclose_normal_reopen_required',
          '유효한 누적 마감 권한은 격리하지 않습니다. 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
        );
      }
      if (current?.status === 'EXACT_REPAIR_REQUIRED') {
        throw applicationError(
          'cashflow_close_reset_to_reclose_exact_recovery_required',
          'immutable evidence가 완전하므로 누적 마감 권한 정확 복구를 먼저 실행해 주세요.',
        );
      }
      if (!current || !['RESET_TO_RECLOSE_READY', 'RECLOSE_READY'].includes(current.status)) {
        throw applicationError(
          'cashflow_close_reset_to_reclose_not_ready',
          '현재 회차 근거로 재결산 준비를 실행할 수 없습니다. 화면을 다시 불러와 회차를 확인해 주세요.',
        );
      }
      if (
        current.status === 'RESET_TO_RECLOSE_READY'
        && stableStringify(expectedEvidence) !== stableStringify(current.expectedEvidence)
      ) {
        throw applicationError(
          'cashflow_close_reset_to_reclose_evidence_changed',
          '재결산 준비 근거가 변경되었습니다. 화면을 다시 불러온 뒤 최신 근거로 다시 시도해 주세요.',
        );
      }

      let result;
      try {
        result = await port.applyCumulativeCloseResetToReclose({
          tenantId,
          projectId,
          peopleUid: actorId,
          reason,
          expectedEvidence,
        });
      } catch (error) {
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RUNTIME_SUPERADMIN_REQUIRED'
        ) {
          throw applicationError(
            'runtime_superadmin_required',
            'People UID가 연결된 ACTIVE runtime admin 권한이 필요합니다.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RESET_NORMAL_REOPEN_REQUIRED'
        ) {
          throw applicationError(
            'cashflow_close_reset_to_reclose_normal_reopen_required',
            '유효한 누적 마감 권한은 격리하지 않습니다. 프로젝트의 정상 재오픈 절차를 사용해 주세요.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RESET_EXACT_RECOVERY_REQUIRED'
        ) {
          throw applicationError(
            'cashflow_close_reset_to_reclose_exact_recovery_required',
            'immutable evidence가 완전하므로 누적 마감 권한 정확 복구를 먼저 실행해 주세요.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RESET_EVIDENCE_CHANGED'
        ) {
          throw applicationError(
            'cashflow_close_reset_to_reclose_evidence_changed',
            '재결산 준비 중 원본 근거가 변경되었습니다. 화면을 다시 불러온 뒤 최신 근거로 다시 시도해 주세요.',
          );
        }
        if (
          error instanceof CashflowPeriodPolicyPersistenceError
          && error.code === 'RESET_EVIDENCE_TRUNCATED'
        ) {
          throw applicationError(
            'cashflow_close_reset_to_reclose_store_unavailable',
            '재결산 근거가 안전 조회 범위를 초과했습니다. AXR팀에서 프로젝트 근거 범위를 확인해 주세요.',
          );
        }
        throw applicationError(
          'cashflow_close_reset_to_reclose_unavailable',
          '재결산 준비를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요. 계속되면 AXR팀에 프로젝트 ID와 함께 알려 주세요.',
        );
      }

      const replayed = result.status === 'RESET_TO_RECLOSE_REPLAYED';
      return {
        ...result,
        statusLabel: replayed ? '재결산 준비 상태 확인' : '재결산 준비 완료',
        guide: replayed
          ? '누적 authority와 mutable 월결산 header가 이미 격리된 상태를 확인했습니다. 추가 변경 없이 시트 검증본 확인과 정상 월결산을 계속 진행해 주세요.'
          : '손상 authority와 현재 mutable 월결산 header의 감사 사본을 남기고 격리했습니다. 시트 검증본을 확인한 뒤 정상 월결산을 다시 진행해 주세요.',
        nextAction: recoveryNextAction(projectId),
      };
    },
  };
}
