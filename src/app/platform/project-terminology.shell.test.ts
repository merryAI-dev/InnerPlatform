import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const TERMINOLOGY_SURFACES = [
  'components/projects/ProjectEditorWizard.tsx',
  'components/projects/ProjectWizard.tsx',
  'components/projects/ProjectDetailPage.tsx',
  'components/projects/ProjectMigrationAuditPage.tsx',
  'components/projects/migration-audit/MigrationAuditDetailPanel.tsx',
  'components/projects/ProjectListPage.tsx',
  'components/dashboard/DashboardPage.tsx',
  'components/participation/ParticipationPage.tsx',
  'components/portal/PortalProjectRegister.tsx',
  'components/portal/PortalProjectEdit.tsx',
  'components/portal/PortalProjectSelectPage.tsx',
  'components/portal/PortalOnboarding.tsx',
  'components/portal/project-proposal.ts',
  'components/approval/AdminApprovalPage.tsx',
  'platform/project-request-review.ts',
  'platform/project-migration-review-dossier.ts',
  'platform/project-migration-console.ts',
  'data/project-completeness.ts',
];

const appSurfaceText = TERMINOLOGY_SURFACES
  .map((path) => readFileSync(resolve(ROOT, path), 'utf8'))
  .join('\n');

const bffRouteText = readFileSync(resolve(REPO_ROOT, 'server/bff/routes/projects.mjs'), 'utf8');
const surfaceText = `${appSurfaceText}\n${bffRouteText}`;

describe('project terminology contract', () => {
  it('does not reintroduce legacy visible terms across registration, edit, and approval surfaces', () => {
    [
      '사업 등록 제안',
      '사업 등록 심사',
      'PM 등록 프로젝트 리뷰',
      'CIC 대표 리뷰',
      '승인 큐',
      '총사업비',
      '총 사업비',
      '매출부가세',
      '입금계획',
      '발주기관',
      '담당팀',
      '등록 프로젝트명',
      '그룹웨어 프로젝트등록명',
      '사업 유형',
      '사업 기간',
      '담당 PM',
      '등록 조직',
      '예정 사업',
      '확정 사업',
      '사업명으로 검색',
      '공식계약명',
      '참여조건',
      '핵심 재무',
      '계약 및 증빙',
      '팀/비고',
      '계좌 유형',
      '입금 방식',
      '오늘 작업할 사업 선택',
      '이 사업으로 시작',
      '담당 사업',
      '내 사업 현황',
      '사업 배정 수정',
      '사업 전환',
      '사업 선택',
      '사업 미선택',
      '사업관리를 시작',
      '기존 사업 선택',
      '새 사업 등록',
      '사업 선택 없이',
      '새로운 사업을 제안',
      '사업명, 클라이언트',
      '사업 통합 대시보드',
      '전사 사업관리',
      '위험 사업',
      '사업 배정',
      '사업명',
      'MYSC 사업 정산유형 분류',
      '동일 발주기관',
      '민간사업',
      'KOICA 사업 통합관리',
      'e나라도움 사업',
      '전체 사업',
      '사업별 현황',
      '사업수',
      '주사업',
      '클라이언트 미지정',
      '신규 프로젝트 등록 완료',
      '프로젝트 임원 심사 결과',
      '선금(%)',
      '중도금(%)',
      '잔금(%)',
      '사업비 수령 방식 및 정산 기준',
      '원문·예산·등록 인력',
      '예산·인력',
      '정식 계약명',
      '계약 및 운영 정보',
    ].forEach((legacyTerm) => {
      expect(appSurfaceText).not.toContain(legacyTerm);
    });

    [
      '신규 프로젝트 등록 완료',
      '프로젝트 임원 심사 결과',
      '발주기관:',
      '담당조직:',
      '메인 담당자:',
      '사업목적:',
    ].forEach((legacyTerm) => {
      expect(bffRouteText).not.toContain(legacyTerm);
    });
  });

  it('keeps the shared standard terms present on the same surfaces', () => {
    [
      '프로젝트 등록 요청',
      '프로젝트 등록 검토',
      'PM 등록 프로젝트 검토',
      'CIC 대표 검토',
      '프로젝트명',
      '계약 대상',
      '담당조직(CIC)',
      '계약금액',
      '매출 부가세',
      '입금 계획',
      '팀/인력',
      '자금 입력 방식',
    ].forEach((standardTerm) => {
      expect(surfaceText).toContain(standardTerm);
    });
  });
});
