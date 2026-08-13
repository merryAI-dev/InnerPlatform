import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContractAmount } from './project-contract-amount-check';

const zero = {
  contractAmount: 0,
  salesVatAmount: 0,
  totalRevenueAmount: 0,
  totalActualCost: 0,
  supportAmount: 0,
};

describe('계약금액 대조', () => {
  it('네 항목의 합과 같으면 아무 말도 하지 않는다', () => {
    const result = checkContractAmount({
      ...zero, contractAmount: 100, salesVatAmount: 10, totalRevenueAmount: 30, totalActualCost: 55, supportAmount: 5,
    });
    expect(result.itemTotal).toBe(100);
    expect(result.gap).toBe(0);
    expect(result.message).toBe('');
  });

  it('계약금액이 더 크면 차이와 방향을 말한다', () => {
    const result = checkContractAmount({
      ...zero, contractAmount: 6_105_000_000, salesVatAmount: 0, totalRevenueAmount: 2_396_275_400,
    });
    expect(result.gap).toBe(3_708_724_600);
    expect(result.message).toContain('3,708,724,600원 큽니다');
    expect(result.message).toContain('2,396,275,400원');
  });

  it('계약금액이 더 작으면 방향이 뒤집힌다', () => {
    const result = checkContractAmount({ ...zero, contractAmount: 100, totalRevenueAmount: 150 });
    expect(result.gap).toBe(-50);
    expect(result.message).toContain('50원 작습니다');
  });

  it('저장을 막지 않는다고 문구에 적는다 — 이건 경고가 아니라 확인 요청이다', () => {
    const result = checkContractAmount({ ...zero, contractAmount: 100, totalRevenueAmount: 40 });
    expect(result.message).toContain('저장은 그대로 됩니다');
  });

  it('계약금액이 아직 비었으면 비교하지 않는다 — 입력 전부터 틀렸다고 하면 안 된다', () => {
    expect(checkContractAmount({ ...zero, totalRevenueAmount: 500 }).message).toBe('');
  });

  it('항목이 전부 비어 있어도 계약금액이 있으면 차이를 말한다 — 지금 프로덕션 대부분이 이 상태다', () => {
    const result = checkContractAmount({ ...zero, contractAmount: 572_000_000 });
    expect(result.itemTotal).toBe(0);
    expect(result.message).toContain('572,000,000원 큽니다');
  });

  it('숫자가 아닌 값은 0으로 본다', () => {
    const result = checkContractAmount({
      ...zero, contractAmount: 100, totalRevenueAmount: Number.NaN as number, salesVatAmount: 100,
    });
    expect(result.gap).toBe(0);
    expect(result.message).toBe('');
  });
});

describe('저장 차단과의 관계', () => {
  it('위저드가 이 결과를 submitIssues 에 넣지 않는다 — 차이가 있어도 저장은 된다', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../components/projects/ProjectEditorWizard.tsx'),
      'utf8',
    );
    const submitBlock = source.slice(
      source.indexOf('const submitIssues = useMemo'),
      source.indexOf('return issues;', source.indexOf('const submitIssues = useMemo')),
    );
    expect(submitBlock).not.toContain('contractAmountCheck');
    expect(submitBlock).not.toContain('checkContractAmount');
    // 계약금액 자체를 자동 계산으로 덮어쓰지도 않는다.
    expect(source).not.toContain("updateAmount('contractAmount', String(");
    expect(source).not.toContain("update('contractAmount', itemTotal");
  });
});
