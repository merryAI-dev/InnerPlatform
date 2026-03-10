# QA P0 Current Code Next Steps

## Fixed constraints
- 정산 시트의 기존 헤더 이름은 바꾸지 않는다.
- 정산 시트의 컬럼 순서는 바꾸지 않는다.
- 새 동작은 기본적으로 feature flag 뒤에 둔다.
- 1차 롤백은 코드 revert가 아니라 flag off로 처리한다.

## What is already implemented
### 1. Settlement P0
- `지출구분`은 내부적으로 legacy 값과 새 라벨을 모두 읽을 수 있다.
- 사용자 노출 라벨은 `사업비카드`, `개인법인카드` 체계를 지원한다.
- `매입부가세` 입력 시 `공급가액`은 보조 계산값으로만 노출된다.
- `증빙자료 드라이브`는 같은 컬럼 안에서 바로 열 수 있다.
- CSV import/export는 기존 헤더와 순서를 유지한다.
- 새 동작은 `VITE_QA_P0_SETTLEMENT_V1`로 제어한다.

### 2. Bank reconciliation P0
- 헤더는 유지한다.
- PM 등 비권한 사용자는 `은행 적요` 원문을 직접 보지 못한다.
- 재경/도담 계열 권한은 원문 적요를 그대로 본다.
- 시스템 쪽 메모는 `거래처` 셀 하단 보조 텍스트로 분리 표시한다.

### 3. Verification
- Vitest helper/CSV/Ralph loop 테스트가 추가되어 있다.
- Playwright smoke가 추가되어 있다.
- 현재 통과 기준:
  - `npm test`
  - `npm run build`
  - `npm run test:e2e`

## Code anchors
- 정산 헤더/순서 기준: `src/app/platform/settlement-csv.ts`
- 정산 입력 UI: `src/app/components/cashflow/SettlementLedgerPage.tsx`
- 권한별 통장내역 표시: `src/app/components/cashflow/BankReconciliationPage.tsx`
- 정산 helper: `src/app/platform/settlement-ledger.helpers.ts`
- flag: `src/app/config/feature-flags.ts`
- Ralph loop: `server/qa-runner/ralph-loop.ts`
- Playwright smoke: `tests/e2e/platform-smoke.spec.ts`

## What is still not done
### 1. 내용 기재 `미완료/완료`
- 타입과 정규화 helper는 들어가 있다.
- 하지만 시트 헤더를 바꿀 수 없어서 별도 컬럼 UI는 아직 넣지 않았다.
- 다음 배치에서는 새 컬럼 추가가 아니라 다음 둘 중 하나로 가야 한다.
- 옵션 A: 기존 `비고` 또는 상세 편집 UI 안에서 상태 드롭다운 제공
- 옵션 B: 행 상세 drawer/modal에서 상태만 관리

### 2. 통장내역 역할 차이
- 지금은 `은행 적요` masking만 구현되어 있다.
- 실제 QA는 은행별 `빠른조회`, `열 메뉴`, 역할별 조회 차이를 말하고 있다.
- 다음 배치에서는 은행 종류별 fixture와 역할 policy matrix가 필요하다.
- 최소 구현 범위:
  - 하나/국민/신한 fixture 준비
  - 역할별 visible field/action 정의
  - helper test 추가
  - 화면에서 policy 적용

### 3. 증빙 자동 리스트업
- 현재는 드라이브 링크 바로 열기만 해결했다.
- `실제 구비 완료된 증빙자료 리스트` 자동 산출은 아직 없다.
- 이건 Drive 구조나 파일명 규칙 없이는 정확히 만들기 어렵다.
- 후속 배치에서 규칙부터 확정해야 한다.

### 4. 나머지 QA backlog
- 기간 지정 엑셀 다운로드
- 엔터/방향키 기반 셀 이동
- 원하는 위치 행 추가/삽입
- 정기지출 자동 입력
- 여러 탭 구성
- 캐시플로우 프로젝션 메모
- 예산 편집/카테고리 관리 버튼 가시성
- 메뉴 순서 재정렬
- 사업 등록 시 기준 정보 선택형 등록

## Recommended next batch order
### Batch 1
- staging에서 `VITE_QA_P0_SETTLEMENT_V1=true`로 실제 업무 QA
- 시트 import/export round-trip 확인
- 법인카드 legacy label이 외부 시트 연동에 문제 없는지 확인

### Batch 2
- `내용 기재 상태` UI 추가
- 단, 헤더/컬럼 추가 없이 구현
- 상태 저장 위치와 표시 위치를 먼저 확정

### Batch 3
- 통장내역 은행별/역할별 policy 정식 구현
- 첨부된 은행 샘플 CSV를 fixture로 흡수
- Playwright에 role/bank matrix smoke 추가

### Batch 4
- 키보드 이동, 기간 다운로드, 원하는 위치 행 추가 같은 사용성 작업
- 이 배치는 UI 회귀가 커서 P0와 분리하는 게 맞다

## Rollback rules
- 정산 라벨/보조 계산/드라이브 열기 이슈: `VITE_QA_P0_SETTLEMENT_V1=false`
- 통장내역 role masking 이슈: helper revert 또는 화면 revert
- QA 자동화 이슈: `test:e2e`만 깨지면 제품 기능보다 하네스부터 본다

## Immediate operator checklist
- PR #43 기준으로 staging 배포 전 env 확인
- `VITE_QA_P0_SETTLEMENT_V1`를 환경별로 명시
- PM 1명, 재경 1명 계정으로 smoke 재확인
- 기존 시트 import 샘플 2~3개로 round-trip 확인
- 은행별 차이 QA용 원본 CSV 확보
