# Sprint Contract: 전사 현금흐름 결산 상태 일괄 조회 안정화

**날짜:** 2026-08-04
**예상 소요:** 1~2시간
**상태:** APPROVED

---

## 구현할 것

- `FirestoreInheritedWeeklyExpensePersistence`
  - 상태 조회 중 실행되는 `cashflow_weeks` revision 반복 계산을 제거한다.
  - `cashflow_settlement_statuses`에 저장된 월·주 결산 상태만 조회한다.
  - 금액과 Projection/Actual 데이터는 변경하지 않는다.
- `WeeklyExpenseCommandService` 및 `WeeklyExpenseController`
  - 여러 프로젝트의 월·주 결산 상태를 한 번에 조회하는 batch endpoint를 추가한다.
  - 프로젝트별 성공 또는 오류를 독립적으로 반환한다.
- `server/bff/routes/jvm-weekly-api.mjs`
  - batch 요청의 프로젝트 수, 중복 ID, 연월을 검증한다.
  - JVM batch endpoint에 한 번만 요청한다.
- `src/app/lib/platform-bff-client.ts`
  - 전사 결산 상태 batch client와 응답 타입을 추가한다.
- `CashflowWeeklyPage`
  - 프로젝트마다 실행하던 `Promise.allSettled` 개별 요청을 batch 요청 하나로 교체한다.
  - 실패한 프로젝트만 `조회 오류`로 표시한다.

## 성공 기준

- [ ] 전사 현금흐름 화면이 프로젝트 수와 관계없이 결산 상태 API를 한 번만 호출한다.
- [ ] 상태 조회 과정에서 `cashflow_weeks` 또는 금액 revision을 다시 계산하지 않는다.
- [ ] 월 결산과 1~5주차 상태가 저장된 상태 문서 기준으로 표시된다.
- [ ] 상태 문서가 없는 프로젝트는 `실무자 업데이트 대기 중`으로 표시된다.
- [ ] 특정 프로젝트 조회가 실패해도 다른 프로젝트 상태는 정상 표시된다.
- [ ] 운영과 유사한 100개 프로젝트 조회가 3초 이내 완료된다.
- [ ] 기존 12초 frontend timeout 때문에 `조회 오류`가 발생하지 않는다.
- [ ] 제출·조직장 승인·완료 상태 전환과 멱등성이 유지된다.
- [ ] 권한 없는 사용자의 상태 조회·변경은 계속 차단된다.
- [ ] Projection, Actual, 월 결산 승인 문서와 감사 기록은 수정되지 않는다.
- [ ] JVM, BFF, frontend 표적 테스트와 production build가 통과한다.

## 실패 기준

- [ ] timeout만 늘리고 프로젝트별 API 호출 구조를 유지한다.
- [ ] 상태 조회가 계속 `cashflow_weeks`를 반복 조회한다.
- [ ] 한 프로젝트 오류가 전체 프로젝트를 `조회 오류`로 만든다.
- [ ] 상태 조회 과정에서 현금흐름 값이 생성·변경·삭제된다.
- [ ] 기존 제출·승인 상태가 초기화되거나 잘못 표시된다.
- [ ] 화면 강제 refresh를 추가한다.
- [ ] 월 결산 승인 또는 기존 주정산 완료 정책이 함께 약화된다.

## 범위 밖

- Projection/Actual 계산 방식 변경
- Google Sheet 동기화 변경
- 기존 월 결산 승인 문서 마이그레이션
- timeout 상향만으로 문제를 숨기는 임시 조치
- 전사 현금흐름 화면의 추가 디자인 개편

## 평가 방법

- 브라우저에서 `/cashflow/weekly` 전사 현금흐름 화면을 연다.
- Network에서 결산 상태 요청이 batch 1건인지 확인한다.
- 100개 프로젝트 fixture로 응답시간 3초 이내를 검증한다.
- 정상·상태 없음·권한 없음·개별 오류 프로젝트를 함께 조회한다.
- 제출 → 조직장 승인 → 완료 상태를 변경하고 재조회한다.
- Firestore에서 상태 문서만 변경되고 현금흐름 값은 그대로인지 확인한다.
- console error와 실패한 반복 요청이 없어야 한다.
- JVM/BFF/frontend 테스트와 production build를 실행한다.
