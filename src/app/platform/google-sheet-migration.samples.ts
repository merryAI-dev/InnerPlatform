import type { GoogleSheetImportPreviewResult } from '../lib/platform-bff-client';

export const DEV_GOOGLE_SHEET_SAMPLE_VALUE = 'sample://migration';

const SAMPLE_SHEETS = [
  { sheetId: 1, title: '예산총괄시트', index: 0 },
  { sheetId: 2, title: '비목별 증빙자료', index: 1 },
  { sheetId: 3, title: 'cashflow(사용내역 연동)', index: 2 },
  { sheetId: 4, title: '사용내역(통장내역기준취소내역,불인정포함)', index: 3 },
  { sheetId: 5, title: '통장내역(MYSC법인계좌e나라도움제외)', index: 4 },
] as const;

const SAMPLE_MATRICES: Record<string, string[][]> = {
  '예산총괄시트': [
    ['사업명', '샘플 사업'],
    ['사업비 구분', '비목', '세목', '산정 내역', '최초 승인 예산', '변경 승인 예산', '특이사항'],
    ['직접사업비', '여비', '교통비', 'KTX 2회', '120000', '150000', '샘플'],
    ['직접사업비', '', '숙박비', '호텔 1박', '80000', '', ''],
    ['직접사업비', '회의비', '다과비', '간식', '30000', '', '필수'],
  ],
  '비목별 증빙자료': [
    ['비목', '중분류', '세목', '사전 업로드', '사후 업로드'],
    ['여비', '', '교통비', '출장신청서', '영수증'],
    ['', '', '숙박비', '', '영수증\n이체확인증'],
    ['회의비', '', '다과비', '', '영수증'],
  ],
  'cashflow(사용내역 연동)': [
    ['구분', '설명', '26-03-1', '26-03-2', '26-04-1'],
    ['매출액(입금)', '', '1000000', '2000000', '3000000'],
    ['직접사업비', '', '400000', '500000', '600000'],
    ['매입부가세', '', '40000', '', '60000'],
  ],
  '사용내역(통장내역기준취소내역,불인정포함)': [
    ['작성자', 'No.', '거래일시', '지출구분', '비목', '세목', '통장에 찍힌 입/출금액', '사업비 사용액', '지급처', '상세 적요'],
    ['데이나', '1', '2026-03-05', '출금', '여비', '교통비', '-15000', '15000', 'KTX', '출장 이동'],
    ['데이나', '2', '2026-03-06', '출금', '회의비', '다과비', '-30000', '30000', '카페 메리', '간식 구매'],
  ],
  '통장내역(MYSC법인계좌e나라도움제외)': [
    ['거래일시', '적요', '출금금액', '입금금액', '잔액'],
    ['2026-03-05 10:00', 'KTX', '15000', '', '985000'],
    ['2026-03-06 15:00', '카페 메리', '30000', '', '955000'],
  ],
};

export function buildDevGoogleSheetImportPreview(
  selectedSheetName = '사용내역(통장내역기준취소내역,불인정포함)',
): GoogleSheetImportPreviewResult {
  const fallbackSheetName = SAMPLE_SHEETS[0]?.title || selectedSheetName;
  const resolvedSheetName = SAMPLE_MATRICES[selectedSheetName] ? selectedSheetName : fallbackSheetName;
  return {
    spreadsheetId: 'sample-migration-workbook',
    spreadsheetTitle: '개발용 사업비 관리 시트 샘플',
    selectedSheetName: resolvedSheetName,
    availableSheets: SAMPLE_SHEETS.map((sheet) => ({ ...sheet })),
    matrix: (SAMPLE_MATRICES[resolvedSheetName] || []).map((row) => [...row]),
  };
}
