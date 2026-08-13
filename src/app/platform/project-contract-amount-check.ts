/**
 * 계약금액과 항목 합계의 대조.
 *
 *   계약금액 = 총매출부가세 + 총수익 + 총실비(원가) + 총지원금
 *
 * 이 식으로 계약금액을 자동 계산하지는 않는다. 2026-08 기준 프로덕션 69건 중 식과
 * 맞는 것은 8건뿐이고, 총실비(원가)는 69건 전부 비어 있다. 자동 계산으로 바꾸면
 * 56건의 계약금액이 다음 저장에 조용히 줄어든다 - 회계 장부에서 되돌리기 어려운 사고다.
 *
 * 그래서 값은 사람이 넣은 것을 그대로 두고, 다를 때 그 자리에서 알려주기만 한다.
 * 실비가 채워지는 만큼 차이가 줄고, 다 채워지면 그때 자동 계산으로 넘어가면 된다.
 */

export interface ContractAmountParts {
  contractAmount: number;
  salesVatAmount: number;
  totalRevenueAmount: number;
  totalActualCost: number;
  supportAmount: number;
}

export interface ContractAmountCheck {
  /** 네 항목의 합 */
  itemTotal: number;
  /** 계약금액 − 항목 합계. 양수면 계약금액이 더 크다. */
  gap: number;
  /** 사람에게 보여줄 한 줄. 맞거나 아직 비교할 수 없으면 빈 문자열. */
  message: string;
}

function toAmount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: number): string {
  return `${Math.abs(value).toLocaleString('ko-KR')}원`;
}

/**
 * 계약금액이 항목 합계와 맞는지 본다.
 *
 * 계약금액이 아직 비었으면 비교하지 않는다 - 입력하기도 전에 경고를 띄우면
 * 처음 등록하는 사람에게는 폼이 처음부터 잘못된 것처럼 보인다.
 */
export function checkContractAmount(parts: ContractAmountParts): ContractAmountCheck {
  const contractAmount = toAmount(parts.contractAmount);
  const itemTotal = toAmount(parts.salesVatAmount)
    + toAmount(parts.totalRevenueAmount)
    + toAmount(parts.totalActualCost)
    + toAmount(parts.supportAmount);
  const gap = contractAmount - itemTotal;

  if (contractAmount === 0) return { itemTotal, gap, message: '' };
  if (gap === 0) return { itemTotal, gap, message: '' };

  const direction = gap > 0 ? '큽니다' : '작습니다';
  return {
    itemTotal,
    gap,
    message: `계약금액이 항목 합계(${formatAmount(itemTotal)})보다 ${formatAmount(gap)} ${direction}.`
      + ' 매출부가세·수익·실비(원가)·지원금을 확인해 주세요. 저장은 그대로 됩니다.',
  };
}
