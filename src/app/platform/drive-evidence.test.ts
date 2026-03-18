import { describe, expect, it } from 'vitest';
import {
  buildDriveTransactionFolderName,
  buildEvidenceCompletedDesc,
  inferEvidenceCategoryFromDocumentText,
  inferEvidenceCategoryFromFileName,
  parseDriveTransactionFolderName,
  suggestEvidenceUploadFileName,
} from './drive-evidence';

describe('drive evidence helpers', () => {
  it('builds deterministic transaction folder names from settlement fields', () => {
    const folderName = buildDriveTransactionFolderName({
      id: 'tx_001',
      dateTime: '2026-03-11',
      budgetCategory: '사업비',
      budgetSubCategory: '홍보비',
      counterparty: '테스트 상점',
      memo: '전단 제작',
    });
    expect(folderName).toBe('20260311_사업비_홍보비_테스트_상점');
  });

  it('parses folder name back into tokens', () => {
    expect(parseDriveTransactionFolderName('20260311_사업비_홍보비_tx_001')).toEqual({
      dateToken: '20260311',
      budgetToken: '사업비',
      subBudgetToken: '홍보비',
      transactionToken: 'tx_001',
      folderName: '20260311_사업비_홍보비_tx_001',
    });
  });

  it('infers evidence category from the file name', () => {
    expect(inferEvidenceCategoryFromFileName('세금계산서_온드림_3월.pdf')).toBe('세금계산서');
    expect(inferEvidenceCategoryFromFileName('attendance_list_march.xlsx')).toBe('참석자명단');
    expect(inferEvidenceCategoryFromFileName('random.bin')).toBe('기타');
  });

  it('covers expanded evidence document categories used by business teams', () => {
    expect(inferEvidenceCategoryFromFileName('2026 온드림 강의자료_v1.pdf')).toBe('강의자료');
    expect(inferEvidenceCategoryFromFileName('프로젝트 견적서_수정본.xlsx')).toBe('견적서');
    expect(inferEvidenceCategoryFromFileName('진행결과보고서_최종.pdf')).toBe('진행결과보고서');
    expect(inferEvidenceCategoryFromFileName('비용지급확인서_홍길동.pdf')).toBe('비용지급확인서');
    expect(inferEvidenceCategoryFromFileName('이체확인증_3월.png')).toBe('이체확인증');
    expect(inferEvidenceCategoryFromFileName('ZOOM invoice March.pdf')).toBe('ZOOM invoice');
    expect(inferEvidenceCategoryFromFileName('표준재무제표증명_2025.pdf')).toBe('표준재무제표증명');
  });

  it('infers 표준재무제표증명 from OCR-like document text', () => {
    const sampleText = `
      급 번 호 표준재무제표증명 처 리 기 간
      1025-275-9002-611 개인 법인 즉 시
      상 호 ( 법 인 명 ) 주식회사 스트레스솔루션 사 업 자 등 록 번 호 753-88-02435
      성 명 ( 대 표 자 ) 배익렬 주민(법인)등록번호 160111-*******
      업 태 정보통신업
      종 목 소프트웨어 개발 및 공급업
    `;
    expect(inferEvidenceCategoryFromDocumentText(sampleText)).toBe('표준재무제표증명');
  });

  it('builds completed desc from uploaded evidence categories', () => {
    expect(buildEvidenceCompletedDesc([
      { id: 'ev1', transactionId: 'tx1', fileName: '세금계산서_a.pdf', fileType: 'application/pdf', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '세금계산서', status: 'ACCEPTED' },
      { id: 'ev2', transactionId: 'tx1', fileName: 'attendance.xlsx', fileType: 'application/vnd.ms-excel', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '', parserCategory: '참석자명단', status: 'ACCEPTED' },
      { id: 'ev3', transactionId: 'tx1', fileName: '세금계산서_b.pdf', fileType: 'application/pdf', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '세금계산서', status: 'ACCEPTED' },
    ])).toBe('세금계산서, 참석자명단');
  });

  it('suggests a normalized upload filename while keeping human review possible', () => {
    expect(suggestEvidenceUploadFileName({
      originalFileName: '강의자료 최종본.pdf',
      category: '강의자료',
      transaction: {
        dateTime: '2026-03-11',
        budgetCategory: '교육운영비',
        budgetSubCategory: '강의자료',
        counterparty: '온드림',
        memo: '3월 교육',
      },
    })).toBe('20260311_교육운영비_강의자료_최종본.pdf');
  });
});
