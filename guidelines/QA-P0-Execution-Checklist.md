# QA P0 Execution Checklist

## Scope
- Branch: `qa/2026-03-05-p0-platform-feedback`
- Preview:
  - direct: `https://inner-platform-6yj6ypg42-merryai-devs-projects.vercel.app`
  - branch alias: `https://inner-platform-git-qa-2026-03-05-p-f8cb83-merryai-devs-projects.vercel.app`
- Feature flag:
  - `VITE_QA_P0_SETTLEMENT_V1=true`

## What changed in Batch 2-4
- Batch 2:
  - `비고` 셀 안에서 `내용 기재 상태`를 `미완료/완료`로 관리할 수 있다.
  - 헤더/컬럼 순서는 그대로 유지한다.
  - 상태는 sheet row 메타로 저장되며 CSV 헤더에는 새 컬럼을 추가하지 않는다.
- Batch 3:
  - 통장내역 업로드 시 `하나/국민/신한/일반` 포맷을 감지한다.
  - 역할별로 `빠른조회`, `열 메뉴`, 원문 적요 노출 정책을 카드로 보여준다.
  - PM은 은행 원문 적요가 계속 마스킹된다.
- Batch 4:
  - 정산 시트에서 원하는 위치 바로 아래에 행을 삽입할 수 있다.
  - 행 구조 변경 후 `No.`는 즉시 재정렬된다.

## Manual QA
1. PM 계정으로 preview 접속 후 `사업비 입력(주간)`을 연다.
2. 1행 `비고` 셀 하단 드롭다운을 `완료`로 바꾸고 저장한다.
3. 같은 행의 `증빙자료 드라이브` 링크가 바로 열리는지 확인한다.
4. 1행 왼쪽 `+` 버튼으로 행을 삽입하고, 새 행이 바로 아래에 생기며 `No.`가 재정렬되는지 확인한다.
5. 기존 CSV를 업로드한 뒤 `사업비카드/개인법인카드`, `공급가액` 보조 문구, 행 삽입이 함께 동작하는지 확인한다.
6. 재경 계정으로 `은행 거래내역 대조`를 열고 하나은행 CSV를 업로드한다.
7. 상단 policy 카드에 `하나은행 빠른조회`, `열 메뉴`, `원문 적요 확인`이 보이는지 확인한다.
8. 같은 화면에서 1행 `은행 적요`가 원문 그대로 보이는지 확인한다.
9. PM 계정으로 같은 CSV를 업로드하고 policy 카드에 `마스킹 적요 확인`이 보이는지 확인한다.
10. PM 화면에서 1행 `은행 적요`가 `권한 필요`로 보이는지 확인한다.
11. 재경 계정으로 국민은행 CSV를 업로드하고 policy 카드가 `국민은행 빠른조회`로 바뀌는지 확인한다.
12. 재경 계정으로 신한은행 CSV를 업로드하고 policy 카드가 `신한은행 빠른조회`로 바뀌는지 확인한다.

## Automated Verification
- `npm test -- src/app/platform/settlement-csv.test.ts src/app/platform/settlement-ledger.helpers.test.ts src/app/platform/bank-reconciliation.test.ts`
- `npm run build`
- `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts`

## Notes
- `내용 기재 상태`는 CSV 헤더를 늘리지 않기 위해 sheet row 메타로 저장된다.
- 따라서 외부 CSV round-trip만으로는 이 상태를 보존하지 않는다.
- 은행별 role policy는 현재 `하나/국민/신한` fixture 기준 1차 구현이며, 실물 CSV가 더 들어오면 header alias를 추가하면 된다.
