/**
 * 계약금액과 항목 합계의 대조.
 *
 *   계약금액 = 총매출부가세 + 총수익 + 총실비(원가) + 총지원금
 *
 * 2026-08-19 이후 **단년도는 이 식으로 자동 계산한다** (제품 결정). 연도가 하나뿐이면
 * "총 계약금액"과 "그 해의 계약금액"이 같은 값이라 사람이 둘을 따로 넣을 이유가 없다.
 * 계산은 `deriveContractAmountFromItems` 가 하고, 화면은 읽기 전용으로 보여준다.
 *
 * 다년도는 연도마다 계약금액이 따로 있으므로 여전히 사람이 넣고, 이 대조만 한다.
 *
 * 자동 계산을 미뤄 왔던 이유는 남아 있다. 2026-08 기준 프로덕션 69건 중 식과 맞는
 * 것은 8건뿐이고, 총실비(원가)는 69건 전부 비어 있다. 그래서 단년도에서도
 * **불러오는 것만으로는 저장된 값을 덮어쓰지 않는다.** 사람이 금액을 고칠 때만
 * 합계로 바뀌고, 그 전까지는 저장값과 합계의 차이를 화면에 띄워 확인을 받는다.
 * 조용히 줄어드는 것이 사고이지, 계산 자체가 사고는 아니다.
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
