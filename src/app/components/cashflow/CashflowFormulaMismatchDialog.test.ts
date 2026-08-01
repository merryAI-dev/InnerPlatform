import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeCashflowFormulaMismatch } from './CashflowFormulaMismatchDialog';

const source = readFileSync(fileURLToPath(new URL('./CashflowFormulaMismatchDialog.tsx', import.meta.url)), 'utf8');

describe('CashflowFormulaMismatchDialog', () => {
  it('explains a missing weekly total with the official sheet calculation', () => {
    const result = describeCashflowFormulaMismatch({
      yearMonth: '2026-12',
      weekNo: 5,
      mode: 'projection',
      field: 'depositTotal',
      reported: null,
      calculated: 0,
      sourceCell: 'BL22',
    });

    expect(result.expected).toBe('BL22 셀은 해당 기간의 입금 항목을 모두 더한 값입니다. 시트에는 0원이 표시되어야 합니다.');
    expect(result.current).toBe('현재 시트에는 이 값이 비어 있습니다.');
  });

  it('explains the first annual balance without inventing a prior-year balance', () => {
    const result = describeCashflowFormulaMismatch({
      year: 2024,
      mode: 'actual',
      field: 'balance',
      reported: null,
      calculated: 0,
      sourceCell: 'C56',
    });

    expect(result.expected).toContain('해당 기간의 입금 합계에서 출금 합계를 뺀 값');
    expect(result.expected).not.toContain('직전 기간 잔액');
  });

  it('explains a later annual balance as a carried-forward balance', () => {
    const result = describeCashflowFormulaMismatch({
      year: 2027,
      mode: 'projection',
      field: 'balance',
      reported: 10,
      calculated: 0,
      sourceCell: 'BM33',
    });

    expect(result.expected).toContain('직전 기간의 잔액에 이번 기간 입금 합계를 더하고 출금 합계를 뺀 값');
    expect(result.current).toContain('10원이 표시되어 있습니다.');
  });

  it('makes the source-value override and platform-calculated totals explicit', () => {
    expect(source).toContain('시트의 원천 항목값을 가져오고');
    expect(source).toContain('입금 합계·출금 합계·잔액은 플랫폼 계산값으로 반영합니다');
    expect(source).toContain('차이를 확인하고 원천값 반영');
    expect(source).toContain('<AlertDialogCancel disabled={busy} onClick={onCancel}>취소</AlertDialogCancel>');
  });
});
