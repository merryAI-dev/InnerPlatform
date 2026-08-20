import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, 'projects.mjs'), 'utf8');
const route = source.slice(source.indexOf("app.post('/api/v1/projects/:projectId/checkout-attachments/"));
const routeBody = route.slice(0, route.indexOf("app.get('/api/v1/project-requests/"));

describe('종료사업 체크아웃 증빙 업로드 라우트', () => {
  it('결재 상태를 건드리지 않는다', () => {
    // 이 경로가 존재하는 이유다. 수정 초안으로 올리면 제출 시 executiveReviewReopens 가
    // 조직장 결재를 다시 연다. 마무리 서류를 붙였다고 결재가 풀리면 안 된다.
    for (const field of [
      'executiveReviewStatus',
      'managementPlanningReviewStatus',
      'executiveReviewHistory',
      'projectCode',
      'executiveReviewReopens',
    ]) {
      expect(routeBody).not.toContain(field === 'executiveReviewReopens' ? field : `${field}:`);
    }
  });

  it('체크아웃 증빙 네 종류만 받는다', () => {
    expect(routeBody).toContain("performance_certificate: 'performanceCertificateDocument'");
    expect(routeBody).toContain("tax_invoice: 'taxInvoiceDocument'");
    expect(routeBody).toContain("final_settlement_report: 'finalSettlementReportDocument'");
    expect(routeBody).toContain("final_report: 'finalReportDocument'");
    // 등록 서류는 이 경로로 바꿀 수 없다.
    expect(routeBody).not.toContain("contract: 'contractDocument'");
    expect(routeBody).not.toContain("quote: 'quoteDocument'");
  });

  it('역할과 사업 배정을 확인하고, 파일을 검증한 뒤 저장한다', () => {
    expect(routeBody).toContain("assertActorRoleAllowed(req, ROUTE_ROLES.writeCore");
    expect(routeBody).toContain('Checkout attachment access denied');
    expect(routeBody).toContain('projectDocumentValidationError(');
    expect(routeBody).toContain('decodeCheckoutBase64(contentBase64, fileSize)');
    // 크기 불일치는 디코더가 잡는다(라우트 밖 헬퍼).
    expect(source).toContain('checkout_attachment_size_mismatch');
  });

  it('version 을 트랜잭션 안에서 올려 되돌려준다', () => {
    expect(routeBody).toContain('db.runTransaction(');
    expect(routeBody).toContain('const nextVersion = Number(current.version || 0) + 1');
    expect(routeBody).toContain('res.status(200).json({ id: projectId, tenantId, version');
  });
});
