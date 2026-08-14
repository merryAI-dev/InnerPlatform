// 금액 안전 연산 (BFF 쪽 도메인). 회계 금액은 정수 원 단위이고, 안전 정수 범위를
// 벗어나는 합산은 값 대신 null 로 알린다 - 조용한 정밀도 손실을 금지한다.
export function safeAmount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export function sumSafe(values) {
  let total = 0;
  for (const value of values) {
    const amount = safeAmount(value);
    if (amount === null) return null;
    const next = total + amount;
    if (!Number.isSafeInteger(next)) return null;
    total = next;
  }
  return total;
}
