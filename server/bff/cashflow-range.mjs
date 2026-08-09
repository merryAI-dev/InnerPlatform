// 연월-주차 순서 키 (BFF 쪽 도메인). 주차 비교는 전부 이 키 하나로 한다.
export function cashflowRangeSortKey(boundary) {
  return Number(boundary.yearMonth.replace('-', '')) * 10 + Number(boundary.weekNo);
}
