import { describe, expect, it } from 'vitest';
import { buildDriveTransactionFolderName, buildEvidenceCompletedDesc, inferEvidenceCategoryFromFileName, parseDriveTransactionFolderName } from './drive-evidence';

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
    expect(folderName).toBe('20260311_사업비_홍보비_tx_001');
  });

  it('parses the deterministic folder name back into tokens', () => {
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

  it('builds completed desc from uploaded evidence categories', () => {
    expect(buildEvidenceCompletedDesc([
      { id: 'ev1', transactionId: 'tx1', fileName: '세금계산서_a.pdf', fileType: 'application/pdf', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '세금계산서', status: 'ACCEPTED' },
      { id: 'ev2', transactionId: 'tx1', fileName: 'attendance.xlsx', fileType: 'application/vnd.ms-excel', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '', parserCategory: '참석자명단', status: 'ACCEPTED' },
      { id: 'ev3', transactionId: 'tx1', fileName: '세금계산서_b.pdf', fileType: 'application/pdf', fileSize: 1, uploadedBy: 'u1', uploadedAt: '2026-03-11', category: '세금계산서', status: 'ACCEPTED' },
    ])).toBe('세금계산서, 참석자명단');
  });
});
