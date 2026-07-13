# Cashflow Sheet Fidelity Design

**Status:** APPROVED
**Approved:** 2026-07-13 — 사용자가 `Projection - Actual` 계산과 구현 시작을 명시함
**Environment:** Stage only

## Goal

원본 사업비 관리 시트의 행 순서와 의미를 MYSCube 캐시플로 화면에 그대로 보존한다. 프론트엔드는 행을 재해석하거나 Projection/Actual을 품목별로 합치지 않는다.

## Fixed Screen Order

화면은 아래 세 블록을 한 화면에 위에서 아래로 표시한다.

1. `Projection - Actual 차이`
2. `Projection`
3. `ACTUAL`

Projection과 ACTUAL은 탭, 품목별 교차 행, 접기 상태로 합치지 않는다.

### Projection rows

1. **MYSC 선입금 - 직접사업비 등**
2. **MYSC 선입금 - MYSC 인건비**
3. **MYSC 선입금 - 메입부가세**
4. 매출액(입금)
5. 매출부가세(입금)
6. 팀지원금(입금)
7. 은행이자(입금)
8. **입금 합계**
9. **MYSC 선입금 - 직접사업비 등**
10. **MYSC 선입금 - MYSC 인건비**
11. 직접사업비(공급가액)
12. 매입부가세
13. MYSC인건비
14. MYSC수익
15. 매출부가세(출금)
16. 팀지원금(출금)
17. 은행이자(출금)
18. **출금 합계**
19. **잔액 (※ 중요)**

### ACTUAL rows

1. **MYSC 선입금 - 직접사업비 등(입금)**
2. **MYSC 선입금 - MYSC 인건비(입금)**
3. **MYSC 선입금 - 매입부가세(입금)**
4. 매출액(입금)
5. 매출부가세(입금)
6. 팀지원금(입금)
7. 은행이자(입금)
8. **입금 합계**
9. **MYSC 선입금 - 직접사업비 등(출금)**
10. **MYSC 선입금 - MYSC 인건비(출금)**
11. 직접사업비(공급가액)
12. 매입부가세
13. MYSC인건비
14. MYSC수익
15. 매출부가세(출금)
16. 팀지원금(출금)
17. 은행이자(출금)
18. **출금 합계**
19. **잔액**

굵게 표시된 행은 화면에서도 강조한다. Projection의 `메입부가세` 표기는 현재 확정 UX 문구를 그대로 사용한다.

## Data Model

기존 `MYSC_PREPAY_IN`은 과거 데이터 호환을 위해 `MYSC 선입금 - 직접사업비 등` 입금으로 유지한다. 다음 네 항목만 추가한다.

- `MYSC_PREPAY_LABOR_IN`
- `MYSC_PREPAY_INPUT_VAT_IN`
- `MYSC_PREPAY_DIRECT_OUT`
- `MYSC_PREPAY_LABOR_OUT`

Projection과 ACTUAL은 같은 line ID를 사용하고 표시 문구만 mode별로 다르게 한다. 입금·출금 합계와 잔액은 저장 행이 아니라 서버 계산 결과다.

같은 Projection 문구가 입금과 출금에 반복되므로 시트 parser는 라벨만으로 판정하지 않는다. `입금 합계` 전후의 방향 문맥과 라벨을 함께 사용한다.

## Difference Contract

- 계산식은 모든 셀과 합계에서 `Projection - Actual`이다.
- 차이는 BFF가 JVM snapshot의 Projection/Actual을 조회·조합해 계산한다.
- 프론트엔드는 받은 값을 포맷하고 표시만 한다.
- 미래 주차는 차이 집계 대상에서 제외한다.
- 행 순서는 Projection/ACTUAL과 동일한 line order를 사용한다.

## Interaction

- Projection: 활성 project lease를 가진 사용자만 편집 가능
- ACTUAL: 조회 전용
- 차이: 조회 전용
- 가로 주차 스크롤과 고정 항목 열은 기존 동작을 유지
- 별도 탭, 새 카드 그리드, 애니메이션, 새 UI 라이브러리는 추가하지 않음

## Error and Compatibility

- 기존 `MYSC_PREPAY_IN` 값은 그대로 읽고 저장한다.
- 새 항목이 없는 과거 문서는 0이 아니라 미작성 상태를 보존한다.
- 시트에서 같은 라벨의 방향을 판정할 수 없으면 임의 매핑하지 않고 unsupported reason을 반환한다.
- 서버 snapshot을 읽지 못하면 오래된 클라이언트 계산으로 대체하지 않고 차이 영역을 오류 상태로 표시한다.

## Verification

- 실제 시트 구조를 닮은 Projection/ACTUAL matrix parser test
- 새 네 line ID의 TypeScript/BFF/JVM/Rust allowlist 및 합계 test
- JVM snapshot의 `Projection - Actual` 비교 test
- 고정된 화면 블록 및 정확한 행 순서 shell test
- Stage 브라우저에서 가로 스크롤, 편집 lease, Actual 조회 전용, 차이 부호 확인

## Out of Scope

- 월 결산·재오픈 상태 머신
- 여러 입금 회차 자동 매칭
- 미지급 총액 산식 확정
- Live 데이터 변경 또는 Live 배포
