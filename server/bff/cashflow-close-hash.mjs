// 월 결산 근거 해시의 단일 소스 (BFF 쪽).
//
// BFF 가 결산 요청의 샤드/manifest 에 이 해시를 써 두고, JVM 이 확정 직전에
// 같은 규칙으로 다시 계산해 "거부 판정"에 쓴다
// (FirestoreInheritedWeeklyExpensePersistence.requireCumulativeCloseApproval).
// 두 런타임이 같은 규칙을 각자 구현하면 조용히 갈린다 - SPEC-16 의 revision 해시가
// JVM a400f3… / BFF ea20de… 로 갈렸던 것이 정확히 이 종류다. 여기가 갈리면 조직장
// 승인 자체가 "근거가 손상되었습니다"로 거부된다.
//
// 그래서 규칙을 이 모듈과 JVM 의 domain/CashflowCloseHash.java 두 곳에만 두고,
// 같은 고정 fixture 표를 양쪽 테스트에 둔다 (cashflow-close-hash.test.mjs /
// CashflowCloseHashTest). 한쪽을 고치면 다른 쪽 표가 깨지도록 한 것이다.
//
// 규칙: 맵 키를 재귀적으로 정렬(UTF-16 코드유닛 순) -> 압축 JSON -> SHA-256 -> "sha256:" 접두.
// 숫자는 JS JSON.stringify 표현을 따른다. JVM 쪽은 BigDecimal.stripTrailingZeros 로
// 1.0 -> 1 을 맞춘다.
import { createHash } from 'node:crypto';
import { stableStringify } from './utils.mjs';

export function cashflowCloseHash(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
