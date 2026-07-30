import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'AdminApprovalPage.tsx'), 'utf8');
const monthlySource = readFileSync(resolve(import.meta.dirname, 'MonthlySettlementApprovalSection.tsx'), 'utf8');
const routesSource = readFileSync(resolve(import.meta.dirname, '../../routes.tsx'), 'utf8');

describe('AdminApprovalPage shell contract', () => {
  it('shows monthly settlement requests before the project registration queue', () => {
    expect(routesSource).toContain("{ path: 'projects/migration-audit', element: <S C={AdminApprovalPage} /> }");
    expect(routesSource).not.toContain("{ path: 'projects/migration-audit', element: <S C={ProjectMigrationAuditPage} /> }");
    expect(source).toContain('ProjectMigrationAuditPage');
    expect(source).toContain('<ProjectMigrationAuditPage embedded reviewScope="pending" />');
    expect(source.indexOf('<MonthlySettlementApprovalSection')).toBeLessThan(
      source.indexOf('<ProjectMigrationAuditPage embedded reviewScope="pending" />'),
    );
    expect(source).toContain('pendingProjectReviews');
    expect(source).toContain('project.executiveReviewStatus');
    expect(source).toContain('프로젝트 등록 검토');
    expect(source).toContain('대표 검토');
    expect(source).toContain('프로젝트 등록 요청부터 먼저 정리합니다');
    expect(source).not.toContain('ProjectRequestApprovalSection');
  });

  it('includes designated-head monthly settlement approval with BFF persistence', () => {
    expect(source).toContain('MonthlySettlementApprovalSection');
    expect(source).toContain('월 결산');
    expect(monthlySource).toContain('fetchPendingCashflowMonthCloseRequestsViaBff');
    expect(monthlySource).toContain('reviewCashflowMonthCloseRequestViaBff');
    expect(monthlySource).toContain("decision: action.decision");
    expect(monthlySource).toContain('반려 사유 (필수)');
    expect(monthlySource).toContain('월 결산 승인 대기 항목이 없습니다');
    expect(monthlySource).toContain('결재 전 확인사항');
    expect(monthlySource).toContain('문서 유형');
    expect(monthlySource).toContain('<table className="w-full min-w-[1040px]');
    expect(monthlySource).toContain('<th className="px-4 py-3">담당조직(CIC)</th>');
    expect(monthlySource).toContain('<th className="px-4 py-3">프로젝트명</th>');
    expect(monthlySource).toContain('<th className="px-4 py-3 text-right">문서</th>');
    expect(monthlySource).toContain("request.documentType === 'MONTHLY_CLOSE'");
    expect(monthlySource).toContain('문서 열기');
    expect(monthlySource).toContain('월 결산 승인서');
    expect(monthlySource).not.toContain('월 결산 검토 및 승인서');
    expect(monthlySource).toContain('MYSCube · MONTHLY CLOSE');
    expect(monthlySource).toContain('기안');
    expect(monthlySource).toContain('조직장 승인');
    expect(monthlySource).toContain('의견 및 처리 이력');
    expect(monthlySource).toContain("entry.kind === 'REQUESTED' ? '요청'");
    expect(monthlySource).toContain("['문서 번호', selectedRequest.requestId]");
    expect(monthlySource).toContain("['문서 유형', '월 결산']");
    expect(monthlySource).toContain('resolveRequestPartyName(request.requestedByName, members, request.requestedByUid)');
    expect(monthlySource).toContain('구성원 이름 확인 불가');
    expect(monthlySource).toContain('buildMonthCloseHistoryEntries(selectedRequest, members)');
    expect(monthlySource).toContain('formatDateTime(request.requestedAt)');
    expect(monthlySource).toContain("timeZone: 'Asia/Seoul'");
    expect(monthlySource).not.toContain('경영기획실 합의');
    expect(monthlySource).toContain('return request.monthSnapshot');
    expect(monthlySource).not.toContain('cashflowSnapshot');
    expect(monthlySource).toContain('Projection');
    expect(monthlySource).toContain('Actual');
    expect(monthlySource).toContain('snapshot.difference.totalIn');
    expect(monthlySource).toContain('warning.code');
    expect(monthlySource).toContain('warning.message');
    expect(monthlySource).toContain('WarningDetail value={warning.details}');
    expect(monthlySource).toContain('위 경고와 셀·주차·금액 상세를 확인했습니다.');
    expect(monthlySource).toContain('warnings.length > 0 && !warningsAcknowledged');
    expect(monthlySource).toContain("window.addEventListener('focus', refresh)");
    expect(monthlySource).toContain("document.addEventListener('visibilitychange', handleVisibility)");
    expect(monthlySource).toContain("window.removeEventListener('focus', refresh)");
    expect(monthlySource).not.toContain('useNavigate');
    expect(monthlySource).not.toContain('fetchCashflowProjectSheet');
    expect(monthlySource).toContain('selectedSource.spreadsheetUrl');
    expect(monthlySource).toContain('저장 시트 열기');
    expect(monthlySource).toContain('저장 시트 링크 없음');
    expect(monthlySource).toContain('selectedSource.spreadsheetTitle');
    expect(monthlySource).toContain('selectedSource.selectedSheetName');
    expect(monthlySource).toContain('annualSummaries');
    expect(monthlySource).toContain('CumulativeSettlementMonthDetails');
    expect(monthlySource).toContain('expectedManifestHash: action.request.manifestHash');
    expect(monthlySource).toContain('승인하면 이 범위의 모든 주차가 수정 불가 상태가 됩니다.');
    expect(monthlySource).not.toContain('AppliedCellHistory');
    expect(monthlySource).not.toContain('fetchCashflowActivityViaBff');
    expect(monthlySource).toContain("cell?.cellState === 'EMPTY'");
    expect(monthlySource).toContain("cell?.cellState === 'ZERO'");
    expect(monthlySource).toContain("return '미입력'");
    expect(monthlySource).toContain('formatMoney(0)');
    expect(monthlySource).not.toContain('week.amounts[lineId] ?? 0');
  });
});
