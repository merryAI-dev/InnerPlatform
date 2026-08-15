import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CashflowPeriodPolicyResponse } from '../../lib/cashflow-period-policy-client';
import { PlatformApiError } from '../../platform/api-client';
import {
  CashflowPeriodPolicyView,
  resolveCashflowPeriodPolicyRecoveryError,
} from './CashflowPeriodPolicyPage';

const snapshot: CashflowPeriodPolicyResponse = {
  status: 'PARTIAL',
  statusLabel: '일부 확인 필요',
  tone: 'caution',
  generatedAt: '2026-08-14T03:00:00.000Z',
  generatedAtLabel: '2026.08.14 12:00',
  issues: [{ code: 'SOURCE_UNAVAILABLE', severity: 'WARNING', severityTone: 'caution', label: '원본 확인 필요', detail: '일부 원본을 읽지 못했습니다.' }],
  superadmins: {
    status: 'OK',
    statusLabel: '슈퍼관리자 연결 정상',
    tone: 'positive',
    items: [{
      uid: 'uid-superadmin', personId: 'person-superadmin', displayName: '변민욱',
      identityStatus: 'LINKED', identityStatusLabel: 'People UID 연결됨', identityTone: 'positive',
    }],
  },
  executiveApproverCandidates: {
    status: 'OK',
    statusLabel: '조직장 후보 조회 완료',
    tone: 'positive',
    items: [{ uid: 'people-uid-a', personId: 'person-a', displayName: '김조직장' }],
  },
  amendments: {
    status: 'AVAILABLE', statusLabel: '닫힌 월 수정 이력 1건', tone: 'positive',
    rows: [{
      id: 'amendment-a', projectId: 'project-a', projectName: 'AXR 프로젝트',
      yearMonth: '2026-07', yearMonthLabel: '2026년 7월',
      reason: '7월 결산 후 직접사업비 정정', reasonLabel: '7월 결산 후 직접사업비 정정',
      actorUid: 'uid-superadmin', actorName: '변민욱', actorLabel: '변민욱',
      closeRevision: 2, closeRevisionLabel: '리비전 2',
      resultingCloseRevision: 3, resultingCloseRevisionLabel: '리비전 3',
      closeSnapshotHash: 'sha256:closed-july', closeSnapshotHashLabel: 'sha256:closed-july',
      sourceRevision: 'source-before', sourceRevisionLabel: 'source-before',
      targetRevision: 'target-before', targetRevisionLabel: 'target-before',
      resultingTargetRevision: 'target-after', resultingTargetRevisionLabel: 'target-after',
      createdAt: '2026-08-13T10:12:00.000Z', createdAtLabel: '2026.08.13 19:12',
    }],
  },
  forecastVariance: {
    status: 'PARTIAL', statusLabel: '전사 편차 부분 비교', tone: 'caution', complete: false,
    eligibleCount: 1, coverageCount: 1, coverageLabel: '전사 비교 가능 1/1주차 · 부분 합계',
    totals: {
      complete: false,
      baseline: { openingBalance: 1000 }, actual: { openingBalance: 900 }, variance: { openingBalance: 100 },
      metrics: [{
        key: 'openingBalance', label: '기초 잔액', baseline: 1000, baselineLabel: '1,000원',
        actual: 900, actualLabel: '900원', variance: 100, varianceLabel: '100원',
      }],
    },
  },
  items: [{
    project: { id: 'project-a', name: 'AXR 프로젝트', status: 'ACTIVE', statusLabel: '운영 중', tone: 'positive' },
    authority: {
      status: 'CLOSED', statusLabel: '누적 마감', tone: 'positive', closedThrough: '2026-07', closedThroughLabel: '2026년 7월까지',
      revision: 4, revisionLabel: 'rev.4', rootHash: 'sha256:authority-a', rootHashLabel: 'sha256:authority-a',
      closedAt: '2026-08-10T00:00:00.000Z', closedAtLabel: '2026.08.10 09:00',
    },
    recovery: {
      status: 'REPAIR_READY', statusLabel: '손상 권한 복구 준비 완료', tone: 'caution', actionAllowed: true,
      expectedEvidence: {
        contractVersion: 'cashflow-cumulative-close-head-recovery-evidence-v1',
        authorityFingerprint: `sha256:${'a'.repeat(64)}`,
        monthlyCloseId: 'project-a-2026-08', monthlyCloseVersionId: 'project-a-2026-08-r1',
        requestId: 'project-a-2026-08', monthlyCloseRevision: 1, requestRevision: 1,
        sourceRevision: `sha256:${'b'.repeat(64)}`, snapshotHash: `sha256:${'c'.repeat(64)}`,
        rootHash: `sha256:${'d'.repeat(64)}`, headRevision: 4,
      },
      reasons: ['HEAD_CONFLICT'],
      warning: '되돌리기 어려운 권한 복구입니다. 현재 head와 복구 후 head의 전체 값은 append-only 감사 사본으로 보존됩니다.',
      guide: '서버가 immutable close evidence로 canonical head를 다시 계산합니다.',
      nextAction: null,
      resetToReclose: {
        status: 'EXACT_REPAIR_REQUIRED', statusLabel: '정확 복구 우선', tone: 'caution',
        actionAllowed: false, selectionAllowed: false, expectedEvidence: null,
        warning: null, guide: 'immutable evidence가 완전하므로 authority 정확 복구를 먼저 사용합니다.',
        cycleCandidates: [],
      },
    },
    latestRun: {
      status: 'CLOSED', statusLabel: '결산 실행 완료', tone: 'positive', yearMonth: '2026-08', yearMonthLabel: '2026년 8월 회차',
      revision: 2, revisionLabel: 'rev.2', closedAt: '2026-08-10T00:00:00.000Z', closedAtLabel: '2026.08.10 09:00',
      closedByUid: 'uid-finance', closedByLabel: '경영기획실 담당자',
    },
    sheet: {
      status: 'PARTIAL', statusLabel: '시트 QA 확인 필요', tone: 'caution', weeklyYear: 2026, weeklyYearLabel: '2026년 주차 결산',
      annualYears: [2024, 2025], annualYearsLabel: '2024년, 2025년 연간형',
      sourceRevision: 'sheet-source-a', sourceRevisionLabel: '원본 sheet-source-a',
      appliedSourceRevision: 'sheet-source-b', appliedSourceRevisionLabel: '반영 sheet-source-b',
      targetRevisionAtFetch: 'target-a', targetRevisionAtFetchLabel: '조회 target-a',
      appliedTargetRevision: 'target-b', appliedTargetRevisionLabel: '반영 target-b',
      revisionStatus: 'MISMATCH', revisionStatusLabel: 'revision 불일치', revisionTone: 'critical',
      capturedAt: '2026-08-14T02:00:00.000Z', capturedAtLabel: '2026.08.14 11:00',
    },
    executiveApprover: {
      status: 'LINKED', statusLabel: '조직장 연결됨', tone: 'positive', uid: 'people-uid-a', personId: 'person-a', displayName: '김조직장',
      expectedVersion: 7, expectedVersionLabel: 'version 7',
      changeAction: { enabled: true, status: 'AVAILABLE', tone: 'positive', guide: '' },
    },
    forecastVariance: {
      status: 'AVAILABLE', statusLabel: '편차 비교 가능', tone: 'positive', eligibleCount: 1, coverageCount: 1,
      coverageLabel: '비교 가능 1/1주차',
      rows: [{
        status: 'AVAILABLE', statusLabel: '비교 가능', tone: 'positive', reason: null, reasonLabel: null,
        projectId: 'project-a', yearMonth: '2026-08', weekNo: 2, weekLabel: '2026년 8월 2주차',
        baseline: {}, actual: {}, variance: {},
        metrics: [{
          key: 'openingBalance', label: '기초 잔액', baseline: 100, baselineLabel: '100원',
          actual: 90, actualLabel: '90원', variance: 10, varianceLabel: '10원',
        }],
      }],
    },
    issues: [{ code: 'REVISION_MISMATCH', severity: 'ERROR', severityTone: 'critical', label: 'revision 불일치', detail: '원본과 반영 revision이 다릅니다.' }],
  }],
};

function render(state: Parameters<typeof CashflowPeriodPolicyView>[0]['state']) {
  return renderToStaticMarkup(createElement(
    MemoryRouter,
    null,
    createElement(CashflowPeriodPolicyView, {
      state,
      savingProjectId: '',
      recoveringProjectId: '',
      resettingProjectId: '',
      onRetry: () => {},
      onUpdateExecutiveApprover: async () => {},
      onRecoverCumulativeCloseHead: async () => {},
      onResetCumulativeCloseToReclose: async () => {},
    }),
  ));
}

describe('CashflowPeriodPolicyView', () => {
  it('renders server-owned labels and arrays in separate authority, run, sheet, issue, and audit sections', () => {
    const html = render({ kind: 'ready', snapshot });

    for (const text of [
      '현금흐름 기간·마감 정책', '정책 / 권한', '월결산 authority', '월결산 run / error',
      'Sheet grain / source revision QA', 'Projection ↔ Actual 편차', 'Issues / UNAVAILABLE', 'Audit',
      '2026년 7월까지', 'sha256:authority-a', '2026년 8월 회차', '2026년 주차 결산', '2024년, 2025년 연간형', '2024', '2025',
      '원본 sheet-source-a', '반영 sheet-source-b', '전사 편차 부분 비교', '전사 비교 가능 1/1주차 · 부분 합계',
      '2026년 8월 2주차', '기초 잔액', '1,000원', '900원', '100원', '90원', '10원',
      'People UID 연결됨', '조직장 후보 조회 완료', '김조직장', '권한 관리', 'version 7', '일부 원본을 읽지 못했습니다.',
      '닫힌 월 수정 이력 1건', '7월 결산 후 직접사업비 정정', 'uid-superadmin',
      '리비전 2', '리비전 3', 'source-before', 'target-before', 'target-after',
      '손상 권한 복구 준비 완료', '되돌리기 어려운 권한 복구', 'append-only 감사 사본',
      'HEAD_CONFLICT', '복구 사유', '권한 복구 실행',
    ]) expect(html).toContain(text);
    expect(html).toContain('bg-emerald-500');
    expect(html).toContain('bg-amber-500');
    expect(html).toContain('bg-rose-500');
    expect(html).toContain('required=""');
    expect(html).toContain('href="/users"');
    expect(html).not.toContain('2023');
    expect(html).not.toContain('정책 스냅샷 생성');
  });

  it('uses an h1 page title, h2 section titles, and h3 nested titles', () => {
    const html = render({ kind: 'ready', snapshot });

    expect(html).toMatch(/<h1[^>]*>현금흐름 기간·마감 정책<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>정책 \/ 권한<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>상위 슈퍼관리자<\/h3>/);
    expect(html).not.toContain('<h4');
  });

  it('renders an accessible loading state', () => {
    const html = render({ kind: 'loading' });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('기간·마감 정책을 불러오는 중입니다');
  });

  it('renders a meaningful empty state without fabricating policy rows', () => {
    const html = render({
      kind: 'empty',
      snapshot: {
        ...snapshot,
        items: [],
        amendments: { status: 'EMPTY', statusLabel: '닫힌 월 수정 이력 없음', tone: 'caution', rows: [] },
      },
    });
    expect(html).toContain('표시할 현금흐름 기간·마감 정책이 없습니다');
    expect(html).toContain('2026.08.14 12:00');
    expect(html).toContain('일부 원본을 읽지 못했습니다.');
    expect(html).toContain('변민욱');
    expect(html).not.toContain('AXR 프로젝트');
  });

  it('shows the amendment store as UNAVAILABLE without fabricating audit rows', () => {
    const html = render({
      kind: 'ready',
      snapshot: {
        ...snapshot,
        amendments: { status: 'UNAVAILABLE', statusLabel: '닫힌 월 수정 이력 조회 불가', tone: 'critical', rows: [] },
      },
    });

    expect(html).toContain('닫힌 월 수정 이력 조회 불가');
    expect(html).toContain('UNAVAILABLE');
    expect(html).not.toContain('7월 결산 후 직접사업비 정정');
    expect(html).not.toContain('정책 스냅샷 생성');
  });

  it('renders a retryable error state', () => {
    const html = render({ kind: 'error', message: '정책을 불러오지 못했습니다.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('정책을 불러오지 못했습니다.');
    expect(html).toContain('다시 불러오기');
  });

  it('renders permission denial in place', () => {
    const html = render({ kind: 'forbidden' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('기간·마감 정책 접근 권한이 없습니다');
    expect(html).not.toContain('다시 불러오기');
  });

  it('서버가 조직장 변경을 잠그면 안내를 표시하고 폼 입력과 submit을 모두 차단한다', () => {
    const html = render({
      kind: 'ready',
      snapshot: {
        ...snapshot,
        items: [{
          ...snapshot.items[0],
          executiveApprover: {
            ...snapshot.items[0].executiveApprover,
            changeAction: {
              enabled: false,
              status: 'LOCKED',
              tone: 'caution',
              guide: '승인 대기 중인 월 결산을 먼저 완료하거나 취소해 주세요.',
            },
          },
        }],
      } as CashflowPeriodPolicyResponse,
    });

    expect(html).toContain('승인 대기 중인 월 결산을 먼저 완료하거나 취소해 주세요.');
    expect(html).toMatch(/<select(?=[^>]*id="executive-approver-project-a")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<input(?=[^>]*placeholder="People UID 연결 근거")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>연결<\/button>/);

    const sectionsSource = readFileSync(resolve(import.meta.dirname, 'CashflowPeriodPolicySections.tsx'), 'utf8');
    expect(sectionsSource).toContain('if (!item.executiveApprover.changeAction.enabled) return;');
    expect(sectionsSource).not.toContain("changeAction.status === 'LOCKED'");
  });

  it('renders the server-provided ERP next action for unrepairable evidence without a recovery button', () => {
    const html = render({
      kind: 'ready',
      snapshot: {
        ...snapshot,
        items: [{
          ...snapshot.items[0],
          recovery: {
            status: 'UNREPAIRABLE', statusLabel: '자동 복구 근거 부족', tone: 'caution', actionAllowed: false,
            expectedEvidence: null, reasons: ['SOURCE_REVISION_INVALID'], warning: null,
            guide: '최신 시트 검증본을 다시 검토·반영한 뒤 정상 월결산으로 증거를 다시 생성해 주세요.',
            nextAction: {
              type: 'REVIEW_SHEET_AND_RECLOSE', label: '시트 검증본 다시 검토',
              href: '/portal/cashflow/project-a/sheets-lab',
            },
            resetToReclose: {
              status: 'UNREPAIRABLE', statusLabel: '재결산 준비 범위 확인 필요', tone: 'caution',
              actionAllowed: false, selectionAllowed: false, expectedEvidence: null,
              warning: null, guide: '격리할 exact 월결산 회차를 확인할 수 없습니다.',
              cycleCandidates: [],
            },
          },
        }],
      },
    });

    expect(html).toContain('자동 복구 근거 부족');
    expect(html).toContain('시트 검증본 다시 검토');
    expect(html).toContain('href="/portal/cashflow/project-a/sheets-lab"');
    expect(html).not.toContain('권한 복구 실행');
  });

  it('renders the server-owned reset-to-reclose action with irreversible audit guidance', () => {
    const resetEvidence = {
      contractVersion: 'cashflow-cumulative-close-reset-to-reclose-evidence-v1' as const,
      authorityFingerprint: `sha256:${'a'.repeat(64)}`,
      monthlyCloseFingerprint: `sha256:${'b'.repeat(64)}`,
      immutableEvidenceFingerprint: `sha256:${'c'.repeat(64)}`,
      monthlyCloseId: 'project-a-2026-08',
      yearMonth: '2026-08',
    };
    const html = render({
      kind: 'ready',
      snapshot: {
        ...snapshot,
        items: [{
          ...snapshot.items[0],
          recovery: {
            status: 'UNREPAIRABLE', statusLabel: '자동 복구 근거 부족', tone: 'caution', actionAllowed: false,
            expectedEvidence: null, reasons: ['SOURCE_REVISION_INVALID'], warning: null,
            guide: 'authority 값을 추측해 만들 수 없습니다.', nextAction: null,
            resetToReclose: {
              status: 'RESET_TO_RECLOSE_READY', statusLabel: '격리 후 재결산 준비 가능', tone: 'caution',
              actionAllowed: true, selectionAllowed: false, expectedEvidence: resetEvidence,
              warning: '되돌리기 어려운 작업이며 전체 before 값은 append-only 감사 사본에 보존됩니다.',
              guide: '2026년 8월 회차를 감사 격리한 뒤 정상 월결산을 다시 진행합니다.',
              cycleCandidates: [],
            },
          },
        }],
      },
    });

    expect(html).toContain('격리 후 재결산 준비 가능');
    expect(html).toContain('되돌리기 어려운 작업');
    expect(html).toContain('append-only 감사 사본');
    expect(html).toContain('재결산 준비 사유');
    expect(html).toContain('재결산 준비 실행');
  });

  it('maps unknown recovery adapter text to fixed Korean guidance without exposing raw English', () => {
    const raw = 'permission adapter exploded: stack trace';
    const conflict = resolveCashflowPeriodPolicyRecoveryError(
      new PlatformApiError('Conflict', 409, 'req-1', { error: 'unknown_conflict', message: raw }),
    );
    const unavailable = resolveCashflowPeriodPolicyRecoveryError(
      new PlatformApiError('Unavailable', 503, 'req-2', { error: 'unknown_failure', message: raw }),
    );

    expect(conflict).toContain('다시 불러');
    expect(unavailable).toContain('AXR팀');
    expect(conflict).not.toContain(raw);
    expect(unavailable).not.toContain(raw);
  });

  it('stores only the selected recovery cycle id and resolves current server evidence at submit time', () => {
    const sectionsSource = readFileSync(resolve(import.meta.dirname, 'CashflowPeriodPolicySections.tsx'), 'utf8');

    expect(sectionsSource).toContain("const [resetCycleId, setResetCycleId] = useState<string | null>(");
    expect(sectionsSource).toContain('const resetEvidence = item.recovery.resetToReclose.expectedEvidence');
    expect(sectionsSource).toContain('candidate.expectedEvidence.monthlyCloseId === resetCycleId');
    expect(sectionsSource).not.toContain('useState<CashflowCumulativeCloseResetToRecloseExpectedEvidence | null>');
  });

  it('never routes raw period-policy adapter text through the generic error resolver', () => {
    const pageSource = readFileSync(resolve(import.meta.dirname, 'CashflowPeriodPolicyPage.tsx'), 'utf8');

    expect(pageSource).not.toContain("resolveApiErrorMessage(error, '기간·마감 정책을 불러오지 못했습니다.')");
    expect(pageSource).not.toContain("resolveApiErrorMessage(error, '조직장 People UID를 연결하지 못했습니다.')");
    expect(pageSource).toContain('기간·마감 정책을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    expect(pageSource).toContain('조직장 People UID를 연결하지 못했습니다. 화면을 다시 불러온 뒤 다시 시도해 주세요.');
  });
});

describe('CashflowPeriodPolicy route and client-calculation boundary', () => {
  const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');
  const navSource = readFileSync(resolve(import.meta.dirname, '../../platform/nav-config.ts'), 'utf8');
  const pageSource = readFileSync(resolve(import.meta.dirname, 'CashflowPeriodPolicyPage.tsx'), 'utf8');
  const sectionsSource = readFileSync(resolve(import.meta.dirname, 'CashflowPeriodPolicySections.tsx'), 'utf8');

  it('registers the admin-only AXR route and navigation entry', () => {
    expect(routesSource).toContain("path: 'axr/cashflow-period-policy'");
    expect(routesSource).toContain('CashflowPeriodPolicyPage');
    expect(navSource).toContain("to: '/axr/cashflow-period-policy'");
    expect(navSource).toContain("label: '현금흐름 기간·마감 정책'");
  });

  it('does not calculate totals, variance, cumulative periods, or permissions in the frontend', () => {
    const frontendSource = `${pageSource}\n${sectionsSource}`;
    expect(frontendSource).not.toContain('.reduce(');
    expect(frontendSource).not.toContain('upsertProjectViaBff');
    expect(frontendSource).not.toContain('projection - actual');
    expect(frontendSource).not.toContain('actual - projection');
    expect(frontendSource).toContain('snapshot.items.map');
    expect(frontendSource).toContain('snapshot.forecastVariance.totals.metrics.map');
    expect(frontendSource).toContain('item.forecastVariance.rows.map');
    expect(frontendSource).toContain('row.metrics.map');
    expect(frontendSource).toContain('snapshot.executiveApproverCandidates.items.map');
    expect(frontendSource).toContain('snapshot.amendments.rows.map');
    expect(frontendSource).not.toContain('item.sheet.annualYears.map');
    expect(frontendSource).not.toContain('{item.sheet.weeklyYear}');
  });
});
