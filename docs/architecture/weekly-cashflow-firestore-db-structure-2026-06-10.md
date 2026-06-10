# 주간 사업비/캐시플로 Firestore 구조

이 문서는 `understand-anything` 그래프와 Java 저장소 코드 `FirestoreInheritedWeeklyExpensePersistence`를 대조해서 정리한 현재 DB 구조다. 운영/PO가 읽을 수 있도록 화면 용어를 먼저 쓰고, 개발자 확인용 컬렉션/필드명은 뒤에 붙였다.

정책 경계:

- 로그인과 포털 진입은 `Google 계정으로 로그인`, `프로젝트 선택` 흐름이다. Java가 회원 프로필을 쓰지 않는다.
- `예산 편집`, `예산 가져오기`, `비목/세목` 관리는 기존 예산 Firestore 경로가 담당한다.
- `사업비 입력(주간)` 화면은 행 입력, 저장, 통장내역 이동, 캐시플로 이동만 담당한다.
- `프로젝트 캐시플로(주간)` 화면만 Projection/Actual 조회, 비교, 엑셀 다운로드를 담당한다.
- Java는 주간 사업비 저장, 행/셀 검증, Actual 계산, 캐시플로 read model, 외부감사용 export snapshot, idempotency만 담당한다.

## 화면 용어 대조표

| 화면에서 보이는 말 | 코드/DB에서의 의미 | 실제 저장 위치 |
| --- | --- | --- |
| 사업비 입력(주간) | 주간 사업비 시트, 행/셀 command | `projects/{projectId}/expense_sheets/{sheetKey}` |
| 거래/행 | 사업비 입력 한 줄 | `expense_sheets/{sheetKey}.rows[]` |
| 통장내역 | 엑셀 업로드 후 반영 후보 | `projects/{projectId}/expense_intake/{sourceLineKey}` |
| 기존 통장내역 가져오기 | 통장내역 기준본에서 사업비 행으로 반영 | `expense_intake` + `expense_sheets.rows[]` |
| 캐시플로 보기 | 캐시플로 화면 이동 | `/portal/cashflow` |
| 프로젝트 캐시플로(주간) | Projection/Actual 주차별 비교 화면 | `cashflow_weeks/{projectId-YYYY-MM-wN}` |
| Projection | 계획값, 캐시플로 화면에서만 편집 | `cashflow_weeks.projection` |
| Actual | 저장된 사업비 행으로 Java가 계산한 기준값 | `cashflow_weeks.actual` |
| 입금/출금 | 캐시플로 라인 묶음 | `projection`, `actual`, `projectionTotals`, `actualTotals` |
| 주차 작성완료/결산완료 | PM 제출, 관리자 마감 상태 | `cashflow_weeks.pmSubmitted`, `adminClosed`, `weeklyStatusState` |
| 엑셀 다운로드/외부감사용 | Projection + Actual + audit summary snapshot | `weekly_api_audit_exports` |
| 예산 편집 | 예산 UI 기존 경로 | Java weekly API 소유 아님 |
| 비목/세목 | 예산/사업비 분류명 | Java는 주간 사업비 검증에만 사용 |

```mermaid
erDiagram
  TENANT ||--o{ LOGIN_MEMBER : "로그인/포털 진입"
  TENANT ||--o{ PROJECT_CONTEXT : "프로젝트 선택"
  PROJECT_CONTEXT ||--o{ WEEKLY_EXPENSE_SHEET : "사업비 입력(주간)"
  WEEKLY_EXPENSE_SHEET ||--o{ WEEKLY_EXPENSE_ROW : "거래/행"
  PROJECT_CONTEXT ||--o{ BANK_STATEMENT_LINE : "통장내역"
  TENANT ||--o{ BANK_UPLOAD_BATCH : "통장 엑셀 업로드"
  TENANT ||--o{ CASHFLOW_WEEK : "프로젝트 캐시플로(주간)"
  CASHFLOW_WEEK ||--o{ ACTUAL_LINE : "Actual"
  CASHFLOW_WEEK ||--o{ PROJECTION_LINE : "Projection"
  TENANT ||--o{ AUDIT_EVENT : "감사 로그"
  TENANT ||--o{ AUDIT_EXPORT : "외부감사용 엑셀"
  TENANT ||--o{ IDEMPOTENCY_RECORD : "중복 저장 방지"

  TENANT {
    string tenantId PK
    string path "orgs/{tenantId}"
  }

  LOGIN_MEMBER {
    string uid PK
    string 이메일
    string 권한
    string 소유권 "Firebase Auth + Firestore"
    string path "members/{uid}"
  }

  PROJECT_CONTEXT {
    string projectId PK
    string 프로젝트명
    string 포털진입상태
    string 예산화면소유권 "기존 Firestore 예산 경로"
    string path "projects/{projectId}"
  }

  WEEKLY_EXPENSE_SHEET {
    string sheetKey PK
    string 화면명 "사업비 입력(주간)"
    number 저장버전 "serverSheetVersion"
    string 저장자 "java-weekly-api"
    timestamp 저장시각
    array 거래행목록 "rows"
    string path "expense_sheets/{sheetKey}"
  }

  WEEKLY_EXPENSE_ROW {
    string tempId
    number 행번호 "rowIndex"
    number 행버전 "serverRowVersion"
    string 원천거래 "sourceTxId"
    string 입력유형 "entryKind"
    number 검증오류수 "validationErrorCount"
    number 검토필요수 "reviewRequiredCount"
    number 입금액 "depositAmount"
    number 환급액 "refundAmount"
    number 사업비 "expenseAmount"
    number 매입부가세 "vatInAmount"
    number 통장금액 "bankAmount"
    array 셀값목록 "cells"
    array 직접수정셀 "userEditedCellIndexes"
  }

  BANK_STATEMENT_LINE {
    string 통장거래키 PK
    string 원천거래 "sourceTxId"
    string 업로드파일명
    number 줄번호
    string 반영상태 "staged/applied"
    string 매칭상태 "PENDING_INPUT/APPLIED"
    object 통장원본값 "bankSnapshot"
    string 원본셀값 "rawCellsJson"
    string 반영된시트
    string 반영된행
    timestamp 반영시각
    string 반영자
    string path "expense_intake/{sourceLineKey}"
  }

  BANK_UPLOAD_BATCH {
    string batchId PK
    string 파일명 "uploadName"
    string 엑셀컬럼 "columnsJson"
    string 상태
    string 업로드자
    timestamp 업로드시각
    string path "weekly_bank_import_batches/{batchId}"
  }

  CASHFLOW_WEEK {
    string 주차문서키 PK "projectId-YYYY-MM-wN"
    string 년월 "yearMonth"
    number 주차 "weekNo"
    object Projection "projection"
    object Actual "actual"
    object 시트별Actual "weeklyExpenseActualBySheet"
    object Projection합계 "projectionTotals"
    object Actual합계 "actualTotals"
    boolean 작성완료 "pmSubmitted"
    boolean 결산완료 "adminClosed"
    string 주차상태 "weeklyStatusState"
    timestamp 업데이트시각
    string path "cashflow_weeks/{projectId}-{yearMonth}-w{weekNo}"
  }

  ACTUAL_LINE {
    string sheetKey PK
    string 캐시플로항목 PK
    number 금액
    string 출처 "저장된 사업비 입력 행"
  }

  PROJECTION_LINE {
    string 캐시플로항목 PK
    number 금액
    string 출처 "캐시플로 화면 Projection 입력"
  }

  AUDIT_EVENT {
    string eventId PK
    string 관련시트
    string 작업명 "저장/복사/붙여넣기/통장반영/작성완료"
    string 작업자
    string 작업자권한
    string 중복방지키
    string 상세내역
    timestamp 생성시각
    string path "weekly_api_audit_events/{autoId}"
  }

  AUDIT_EXPORT {
    string exportId PK
    string 파일유형
    string 파일명
    string 파일해시
    string 파일내용
    number Projection줄수
    number Actual줄수
    number 감사로그수
    string 생성자
    timestamp 생성시각
    string path "weekly_api_audit_exports/{autoId}"
  }

  IDEMPOTENCY_RECORD {
    string id PK "projectId+작업명+중복방지키"
    string 중복방지키
    string 작업명
    string 요청해시
    string 응답내용
    timestamp 생성시각
    string path "weekly_api_idempotency/{safeDocId}"
  }
```

```mermaid
flowchart LR
  Login["Google 계정으로 로그인"] --> ProjectSelect["프로젝트 선택"]
  ProjectSelect --> WeeklyPage["사업비 입력(주간)\n행 입력/저장/이동"]
  ProjectSelect --> BankPage["통장내역\n엑셀 업로드/반영 항목 선택"]
  BankPage --> WeeklyPage
  WeeklyPage --> JavaWeekly["Java 주간 사업비 저장\n셀/행 검증 + Actual 계산"]
  JavaWeekly --> WeeklySheet["저장된 사업비 행\nexpense_sheets.rows"]
  JavaWeekly --> CashflowReadModel["캐시플로 주차 기준값\nProjection/Actual"]
  CashflowReadModel --> CashflowPage["프로젝트 캐시플로(주간)\nProjection 편집/Actual 확인/비교"]
  CashflowPage --> AuditDownload["엑셀 다운로드\n외부감사용 snapshot"]
  JavaWeekly --> AuditLog["감사 로그\n누가/언제/무슨 작업"]
  JavaWeekly --> DuplicateGuard["중복 저장 방지\nidempotency"]
  ProjectSelect --> BudgetPage["예산 편집\n비목/세목/예산 가져오기"]

  JavaWeekly -. "금지: 회원 프로필 쓰기" .-> Login
  JavaWeekly -. "금지: 예산 화면 소유" .-> BudgetPage
  WeeklyPage -. "금지: Projection/Actual 직접 집계" .-> CashflowReadModel
```

## 캐시플로 항목명

| 화면 묶음 | 화면/업무 용어 | 내부 코드 |
| --- | --- | --- |
| 입금 | MYSC 선급금 입금 | `MYSC_PREPAY_IN` |
| 입금 | 매출 입금 | `SALES_IN` |
| 입금 | 매출 부가세 입금 | `SALES_VAT_IN` |
| 입금 | 팀 지원금 입금 | `TEAM_SUPPORT_IN` |
| 입금 | 은행 이자 입금 | `BANK_INTEREST_IN` |
| 출금 | 사업비 | `DIRECT_COST_OUT` |
| 출금 | 매입부가세 | `INPUT_VAT_OUT` |
| 출금 | MYSC 인건비 | `MYSC_LABOR_OUT` |
| 출금 | MYSC 이익 | `MYSC_PROFIT_OUT` |
| 출금 | 매출 부가세 출금 | `SALES_VAT_OUT` |
| 출금 | 팀 지원금 출금 | `TEAM_SUPPORT_OUT` |
| 출금 | 은행 이자 출금 | `BANK_INTEREST_OUT` |

## Stage 저장 검증

2026-06-10 stage smoke에서 Java가 실제로 쓴 경로:

- `orgs/stage-smoke/projects/stage-verify-codex20260610105103/expense_sheets/default`
- `orgs/stage-smoke/cashflow_weeks/stage-verify-codex20260610105103-2026-06-w1`
- `orgs/stage-smoke/weekly_api_audit_events/*`
- `orgs/stage-smoke/weekly_api_audit_exports/*`
- `orgs/stage-smoke/weekly_api_idempotency/*`
