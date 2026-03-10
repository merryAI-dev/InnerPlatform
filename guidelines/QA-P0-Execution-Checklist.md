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
  - 상태는 `비고` 셀 값에 `[미완료]`, `[완료]` prefix로 인코딩되어 CSV round-trip 시 함께 보존된다.
- Batch 3:
  - 통장내역 업로드 시 `하나/국민/신한/일반` 포맷을 감지한다.
  - 역할별로 `빠른조회`, `열 메뉴`, 원문 적요 노출 정책을 카드로 보여준다.
  - PM은 은행 원문 적요가 계속 마스킹된다.
- Batch 4:
  - 정산 시트에서 원하는 위치 바로 아래에 행을 삽입할 수 있다.
  - 행 구조 변경 후 `No.`는 즉시 재정렬된다.
  - `시트 보기` / `주차 보기` 탭을 오갈 수 있다.
  - `Enter`, `Shift+Enter`, `↑↓`, 텍스트 끝의 `←→`로 셀 이동이 가능하다.
  - 기간 지정 `CSV/XLSX` 다운로드가 가능하다.

## Manual QA
1. PM 계정으로 preview 접속 후 `사업비 입력(주간)`을 연다.
2. 상단 `시트 보기` 탭에서 1행 `비고` 셀 하단 드롭다운을 `완료`로 바꾸고 저장한다.
3. 같은 행의 `증빙자료 드라이브` 링크가 바로 열리는지 확인한다.
4. 1행 왼쪽 `+` 버튼으로 행을 삽입하고, 새 행이 바로 아래에 생기며 `No.`가 재정렬되는지 확인한다.
5. 상단 기간 입력을 `2026-03-01 ~ 2026-03-31`처럼 지정하고 `기간 CSV`, `기간 XLSX`가 각각 내려받아지는지 확인한다.
6. 내려받은 CSV 안의 `비고` 셀에 `[완료] ...` prefix가 포함되는지 확인한다.
7. 시트에서 `거래일시` 셀에 포커스한 뒤 `Enter`로 아래 행, `Shift+Enter`로 위 행으로 이동되는지 확인한다.
8. 상단 `주차 보기` 탭으로 전환했을 때 주차별 섹션이 보이는지 확인한다.
9. 기존 CSV를 업로드한 뒤 `사업비카드/개인법인카드`, `공급가액` 보조 문구, 행 삽입이 함께 동작하는지 확인한다.
10. 재경 계정으로 `은행 거래내역 대조`를 열고 하나은행 CSV를 업로드한다.
11. 상단 policy 카드에 `하나은행 빠른조회`, `열 메뉴`, `원문 적요 확인`이 보이는지 확인한다.
12. 같은 화면에서 1행 `은행 적요`가 원문 그대로 보이는지 확인한다.
13. PM 계정으로 같은 CSV를 업로드하고 policy 카드에 `마스킹 적요 확인`이 보이는지 확인한다.
14. PM 화면에서 1행 `은행 적요`가 `권한 필요`로 보이는지 확인한다.
15. 재경 계정으로 국민은행 CSV를 업로드하고 policy 카드가 `국민은행 빠른조회`로 바뀌는지 확인한다.
16. 재경 계정으로 신한은행 CSV를 업로드하고 policy 카드가 `신한은행 빠른조회`로 바뀌는지 확인한다.

## Automated Verification
- `npm test -- src/app/platform/settlement-csv.test.ts src/app/platform/settlement-ledger.helpers.test.ts src/app/platform/bank-reconciliation.test.ts`
- `npm run build`
- `npm run test:e2e -- tests/e2e/platform-smoke.spec.ts`

## Notes
- `내용 기재 상태`는 `비고` 셀 문자열에 prefix로 저장되므로, 헤더 변경 없이 외부 CSV round-trip으로 보존된다.
- 은행별 role policy는 현재 `하나/국민/신한` fixture 기준 1차 구현이며, 실물 CSV가 더 들어오면 header alias를 추가하면 된다.
