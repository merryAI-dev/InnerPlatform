# 캐시플로우 대시보드·월 결산 명세

- 상태: 요구사항 검토본
- 기준일: 2026-07-13
- 대상: Stage 전용
- 구현 조건: 본 명세 승인

## 1. 확정 전제

1. 원본 사업비 관리 스프레드시트는 읽기 전용이며 수식과 셀을 변경하지 않는다.
2. 프로젝트 등록 정보가 사업 구분·정산·계좌·총사업비의 기준이다.
3. 잠금은 URL이 아니라 `tenantId + resourceType + projectId`로 구분한다.
4. 프론트엔드는 표시와 입력 수집만 담당한다.
5. BFF는 조회·조합을 담당하고 금융 원장과 결산의 권위는 Spring/JVM에 둔다.
6. 기존 `monthly_closes`의 급여 의미와 Stage 데이터는 폐기하고 캐시플로우 월 결산으로 재정의한다.
7. Live 데이터와 Live 배포는 범위 밖이다.
8. 기존 구조를 유지해 BFF가 lease와 비공개 임시저장까지 관리한다.

## 2. 목표와 범위

프로젝트별 Projection과 Actual을 조회하고, PM이 충돌 없이 임시저장한 뒤 명시적인 최종저장으로 월 결산할 수 있게 한다.

포함:

- 프로젝트 등록 정보와 사업비 관리 시트 대조
- 세금계산서 발행일, 입금예정일, 입금일, 입금액 표시
- 전체 주차 Projection/Actual과 월 합계
- 프로젝트별 30분 수정 lease와 이전 세션 인계
- 비공개 임시저장, 최종저장, 월 결산, 재오픈 승인
- Stage 두 사용자·두 세션 QA

### PPT·확정 UX 화면 계약

- 관리자 화면은 `Projection - Actual 차이 → Projection 전체 블록 → ACTUAL 전체 블록` 순서로 표시한다.
- Projection과 ACTUAL의 품목 반복은 확정된 업무 구조다. 품목별 교차 표시, 탭, 임의 재정렬로 바꾸지 않는다.
- Projection과 ACTUAL 내부 행 순서·문구·강조는 `docs/superpowers/specs/2026-07-13-cashflow-sheet-fidelity-design.md`를 따른다.
- 요약은 Projection 진척, Actual 진척, 현재 주차까지의 Projection/Actual 일치 여부를 서버 계산값으로 표시한다.
- Projection은 총 계약금액 대비로 계산하며 총 계약금액이 0이면 100%로 표시한다.
- Actual과 차이는 현재 주차까지만 계산한다. 미래 주차는 미달·차이로 판단하지 않는다.
- 입금은 초록, 출금은 빨강, 차이 금액은 파랑의 의미 색상을 사용한다.
- 상세 표의 `전체` 보기는 제거하고 연도 이동, 월 선택, 월 결산을 제공한다.
- 상세 표는 기본 조회 전용이며 편집 lease를 얻은 PM만 입력 컨트롤을 사용할 수 있다.
- 연동 방향은 `사업비 관리 시트 → MYSCube` 한 방향으로 고정한다. `시트로 내보내기` UI와 쓰기 경로는 제거하고 `시트값 불러오기`만 둔다.
- 변경 이력에는 누가, 언제, 무엇을 바꿨는지 표시한다.
- 목요일 24시 업데이트 기준과 미준수 횟수는 단순 표시한다. 자동 권한 제한에는 사용하지 않는다.
- PPT의 주요 관리 항목은 서버가 계산한 경고로 표시하되, 이번 단계에서는 자동 송금·자동 수정·자동 결산을 수행하지 않는다.
- 모든 차이는 `Projection - Actual`로 계산하며 프론트엔드는 차이를 다시 계산하지 않는다.

제외:

- 원본 시트 수정
- Live 배포
- 여러 입금 회차 자동 매칭 규칙 확정
- 미입금 총액 산식 확정
- 새로운 권한 프레임워크 도입

## 3. 시스템 경계

| 계층 | 책임 | 금지 |
|---|---|---|
| Frontend | 서버 응답 표시, 입력 수집, 액션 호출, 읽기 모드·이탈 경고 | 권한 판정, 금융 계산, Firestore 직접 쓰기, 자동 최종저장 |
| BFF | 프로젝트·시트·거래·JVM 조회 결과 조합, 화면 DTO, 기존 lease·비공개 draft 운영 | `cashflow_weeks`, `monthly_closes`의 권위 있는 저장 |
| Spring/JVM | 저장된 역할·프로젝트·lease/session/fence 검증, 금융 계산 검증, 결산·재오픈, 멱등성·감사로그 | 프론트가 보낸 역할·합계·권한 플래그 신뢰 |
| Firestore Rules | 브라우저의 canonical collection 쓰기 차단 | UI 상태만 믿고 쓰기 허용 |

`canEdit`, `canFinalize`, `canRequestReopen`은 표시용이다. 실제 허용 여부는 JVM이 매 요청마다 판정한다.

## 4. 데이터 원천

| 표시값 | 기준 | 규칙 |
|---|---|---|
| 사업 구분 | `projects.settlementType + basis` | 별도 중복 필드를 만들지 않는다. |
| 정산 여부 | `projects.settlementType` | `NONE`이 아니면 정산 대상 |
| 계좌 사업 | `projects.accountType` | `전용계좌사업 → DEDICATED`, `MYSC운영비계좌사업 → OPERATING` |
| 자금 입력 방식 | `projects.fundInputMode` | `BANK_UPLOAD` 또는 `DIRECT_ENTRY` |
| 총 사업비 | `projects.contractAmount` | 시트 값과 다르면 경고만 표시한다. |
| 세금계산서 발행일 | 사업비 관리 시트 | 사람 확인 후 Actual로 인정한다. |
| 입금예정일·예정액 | 사업비 관리 시트 | Projection으로 표시한다. |
| 실제 입금일·입금액 | 거래 매칭 또는 시트 직접입력 | 입력 방식에 따라 가져오고 사람이 확인한다. |
| 주차별 합계 | 시트 `D:BK` | 서버가 60개 주차를 합산한다. `BO`는 시트 수식 결과와 대조하는 control total로 보존한다. |

추가 규칙:

- 열린 월은 BFF가 최신 프로젝트·시트·거래 데이터를 조합한다.
- 현재 월은 Projection과 Actual을 함께 표시한다.
- 지난 주차의 실적 판단은 Actual을 우선하고 Projection은 비교용으로 보존한다.
- 프로젝트와 시트가 다르면 불일치 경고만 표시하고 자동 변경하지 않는다.
- 결산 월은 `monthly_closes.snapshot`만 조회한다.
- 시트의 기존 수식은 변경하거나 재작성하지 않는다.
- 전체 주차 합계와 `BO` control total이 다르면 불일치 경고를 표시하고 사람이 확인하기 전에는 결산하지 않는다.
- 화면은 `BO9` 입금 합계와 `BP9` 미지급 수식 결과를 서버 응답 그대로 표시한다. `BP9`는 산식 확정 전 표시용이며 프론트에서 재계산하지 않는다.
- 캐시플로우에 표시되는 모든 작성 항목은 사람이 `확인` 또는 `해당 없음`으로 판정한다.
- 빈 값은 자동으로 `해당 없음`으로 간주하지 않는다.

### 현재 원본 시트 mapping

대상 sheet: `cashflow(사용내역 연동)`

| 의미 | range/cell | 처리 |
|---|---|---|
| 최종 업데이트·작성자 안내 | `B1` | 표시용 원문으로 읽고 시스템 감사로그와 별도로 보존 |
| 사업 구분 | `B2` | 프로젝트 등록값과 대조 |
| 전용계좌사업 여부 | `B3` | 프로젝트 등록값과 대조 |
| 정산진행 여부 | `B4` | 프로젝트 등록값과 대조 |
| 세금계산서 발행일 | `D7:BK7` | 60개 주차별 원천값 |
| 입금일 | `D8:BK8` | 60개 주차별 원천값 |
| 입금액 | `D9:BK9` | 60개 주차별 원천값 |
| 입금 control total | `BO9` | 현재 원본 수식 `=G9`; 변경하지 않고 전체 주차 합계와 대조 |
| 미지급 control total | `BP9` | 현재 원본 수식 `='예산총괄시트'!F27-BO9`; 미지급 산식 확정 전 표시용 |
| Projection | `D14:BK32` | 60개 주차별 값, `BL:BN` 월 꼬리열은 주차 mapping에서 제외, `BO14:BO32` control total |
| Actual | `D37:BK55` | 60개 주차별 값, `BL:BN` 월 꼬리열은 주차 mapping에서 제외, `BO37:BO55` control total |

확인된 원본 특성:

- 월 헤더는 `D:I:N:...:BG`, 주차 데이터는 `D:BK`, 주차 라벨 없는 월 꼬리열은 `BL:BN`, 합계는 `BO`, 미지급은 `BP`다.
- `C5`, `C11`은 `2027년`으로 적혀 있지만 실제 날짜 헤더는 2026-01-01부터 2027-03-01까지다.
- 연도 표시는 텍스트 셀만 믿지 않고 실제 날짜 헤더를 기준으로 그룹화한다. 불일치는 경고로 표시하고 원본은 수정하지 않는다.
- 원본 파일 SHA-256 기준값은 `e3ce2a8640cf45ffda7f68fe79f4529c87548c44618ebd1474956ea2a5363ac1`이다.

## 5. 수정 lease와 임시저장

### 프로젝트별 lease

- 키: `tenantId + resourceType + projectId`
- 검증값: `actorId + sessionId + leaseId + fence + expiresAt`
- TTL: 30분
- 서버 시간이 만료 기준이다.

진입 규칙:

1. 활성 lease가 없으면 현재 세션이 편집권을 얻는다.
2. 같은 사용자의 다른 세션이 보유 중이면 `이전 수정 세션 이어서 작성` 팝업을 표시한다.
3. 인계 시 fence를 증가시키고 이전 세션의 저장을 거절한다.
4. 다른 사용자가 보유 중이면 아래 안내를 한 번만 표시하고 읽기 모드로 전환한다.

> 현재 {사용자 표시명}님이 수정 중입니다. 지금은 수정은 불가능하지만 읽기/조회는 가능해요!

`읽기 모드로 보기` 이후 같은 `leaseId + fence`에는 팝업을 다시 띄우지 않는다.

연장·만료:

- 남은 시간을 표시하고 `30분 연장` 버튼을 제공한다.
- 탭 sleep이나 네트워크 단절은 lease를 무기한 연장하지 않는다.
- 만료 시 draft는 유지하고 선점 상태만 해제한다.
- 만료된 세션의 저장은 거절하고 `수정 세션이 종료되었습니다`를 표시한다.

이탈:

- 앱 내부 이동: `임시저장 후 종료 / 저장하지 않고 종료 / 계속 작성`
- 새로고침·닫기: 표준 `beforeunload` 경고만 사용
- 새로고침을 저장 수단으로 사용하지 않는다.
- 최종저장은 이탈 시 자동 실행하지 않는다.

### 임시저장

- 작성자와 같은 사용자의 인계 세션만 볼 수 있다.
- Admin, Finance, 다른 PM에게는 보이지 않는다.
- 저장마다 `draftRevision`을 올리고 오래된 revision은 `409`로 거절한다.
- lease가 만료돼도 draft는 삭제하지 않는다.
- 월 결산 입력을 포함한 draft의 열기·수정·완료는 같은 `monthly_closes` 문서를 transaction 안에서 확인하고, `CLOSED`·`REOPEN_REQUESTED`이면 거절한다.

## 6. 최종저장과 월 결산

캐시플로우의 최종저장은 해당 월의 결산이다.

```text
OPEN ──PM 최종저장──> CLOSED ──PM 요청──> REOPEN_REQUESTED
  ^                                           │
  └───────────── Finance/Admin 승인 ──────────┘
                              반려 ─────────> CLOSED
```

- 월 결산 문서가 없으면 논리적으로 `OPEN`이다. `OPEN` 문서를 미리 만드는 worker는 두지 않는다.
- 대상 월이 끝나기 전에는 최종저장·월 결산을 제공하지 않는다.
- 결산 가능 기간은 다음 달 1일부터이며 결산 기한은 다음 달 10일이다.
- 10일이 지나도 결산은 허용하되 `기한 초과`로 표시하고 감사로그에 남긴다.
- PM은 할당 프로젝트의 활성 lease와 최신 draftRevision으로만 최종저장한다.
- 표시된 모든 캐시플로우 항목이 `확인` 또는 `해당 없음`이어야 최종저장할 수 있다.
- BFF는 최신 원천과 draft를 다시 읽어 JVM에 전달한다.
- JVM은 권한·월 상태·fence·금액 규칙을 검증한다.
- JVM은 snapshot, 결산 상태, 감사로그, 멱등성, lease 종료를 canonical transaction으로 확정한다.
- `CLOSED`와 `REOPEN_REQUESTED`에서는 모든 수정 요청을 거절한다.
- 재오픈 요청에는 사유가 필수다.
- Finance/Admin 승인 시 `OPEN`으로 바꾸고 `reopenCount`를 1 증가시킨다.
- 승인 후 새 lease를 받아야 수정할 수 있다.
- 재결산 감사로그에는 이전·신규 snapshot hash와 변경값을 남긴다.
- 프로젝트 경고 횟수는 해당 프로젝트의 월별 `reopenCount` 합계로 계산한다.
- 재오픈 경고 횟수는 정보 표시용이며 횟수에 따른 자동 제한이나 권한 변경은 하지 않는다.

## 7. 권한

| 액션 | PM | Finance/Admin | Viewer |
|---|---:|---:|---:|
| 조회 | 할당 프로젝트 O | O | 허용 범위 O |
| lease·임시저장 | 할당 프로젝트 O | X | X |
| 최종저장·월 결산 | 할당 프로젝트 O | X | X |
| 재오픈 요청 | 할당 프로젝트 O | X | X |
| 재오픈 승인·반려 | X | O | X |
| 다른 사용자의 draft 조회 | X | X | X |

## 8. Firestore 모델

재사용:

- `orgs/{tenantId}/projects/{projectId}`
- `orgs/{tenantId}/editLeases/{leaseKey}`
- `orgs/{tenantId}/privateEditDrafts/{projectId_actorId}`
- `orgs/{tenantId}/cashflow_weeks/{projectId_yearMonth_week}`
- 기존 감사 체인과 멱등성 저장소

`monthly_closes` 재정의:

```text
orgs/{tenantId}/monthly_closes/{projectId}-{YYYY-MM}
```

| 필드 | 내용 |
|---|---|
| `tenantId`, `projectId`, `yearMonth` | 결산 범위 |
| `status` | `OPEN`, `CLOSED`, `REOPEN_REQUESTED` |
| `revision`, `reopenCount` | 동시성·경고 횟수 |
| `snapshot.project` | `settlementType`, `basis`, `accountType`, `fundInputMode`, `contractAmount` |
| `snapshot.depositScheduleRows[]` | 주차, 발행일, 예정일·액, 실제 입금일·액, Actual 원천, 사람 확인 여부 |
| `snapshot.confirmations[]` | 항목 키, `CONFIRMED` 또는 `NOT_APPLICABLE`, 확인자, 확인 시각 |
| `snapshot.weeklyTotals[]` | 주차별 Projection·Actual |
| `snapshot.projectionTotal`, `actualTotal` | 전체 주차 월 합계 |
| `snapshot.sourceFingerprint`, `sourceReadAt` | 읽은 원천의 감사 정보 |
| `snapshotHash` | 재결산 비교값 |
| `closedAt`, `closedBy*` | 결산 이력 |
| `reopenRequest` | 사유, 요청자, 요청 시각 |
| `createdAt`, `updatedAt` | 문서 시각 |

폐기:

- 급여용 `status: OPEN | DONE`
- `acknowledged`, `acknowledgedAt`, `acknowledgedBy*`
- 급여 worker의 월 문서 자동 생성
- 급여 화면의 `monthly_closes` 직접 구독·확인 UI
- 브라우저의 `setDoc`, `updateDoc` 월 마감

collection 스키마와 기존 소비자 제거를 한 작업 단위로 처리한다.

## 9. 서버 명령

- BFF `getCashflowDashboard(projectId, yearMonth)`
  - 열린 월은 최신 원천을 조합하고 닫힌 월은 snapshot을 반환한다.
  - 화면용 권한 플래그와 lock 상태를 함께 반환한다.
- BFF `GET /api/v1/cashflow/{projectId}?rangeStart=YYYY-MM:W&rangeEnd=YYYY-MM:W`
  - JVM 원장 주차를 지정 범위로 합산해 `readModel.range.projection|actual`의 품목별 합계, 입금 합계, 출금 합계, 잔액을 반환한다.
  - 프론트엔드는 기간 합계를 다시 더하지 않고 이 응답을 그대로 표시한다.
- JVM `closeCashflowMonth`
  - PM, 프로젝트, 월 상태, lease, fence, draftRevision, idempotency를 검증한다.
- JVM `updateCashflowVariance`
  - 편차 검토의 역할, lease, 월 상태, revision, 상태 전이를 검증하고 `cashflow_weeks`를 원자적으로 갱신한다.
- JVM `requestCashflowMonthReopen`
  - PM과 필수 사유를 검증한다.
- JVM `decideCashflowMonthReopen`
  - Finance/Admin만 승인·반려한다.
- 기존 주차 단위 `submit`·`close` 명령은 BFF와 JVM 모두 기본 `410 Gone`으로 차단하고 월 결산 계약만 상태 변경에 사용한다.

같은 idempotency key와 같은 요청은 기존 결과를 반환한다. 같은 key의 다른 요청은 `409`로 거절한다.

## 10. 오류 규칙

| 상황 | 응답 | 처리 |
|---|---:|---|
| 다른 세션이 보유 | 423 | 안내 1회 후 읽기 모드 |
| lease 만료 | 410 | 종료 안내, draft 유지 |
| revision 충돌 | 409 | 최신 상태 재조회, 자동 덮어쓰기 금지 |
| 권한 없음 | 403 | 액션 차단, 조회는 별도 권한 적용 |
| 시트 조회 실패 | 502/503 | 화면 유지, 결산 금지 |
| JVM transaction 실패 | 5xx | 기존 월 상태 유지, 같은 idempotency key로 재시도 |

## 11. Overwrite 영향 범위

유지:

- 기존 BFF lease와 비공개 draft
- 기존 JVM cashflow write guard
- `cashflow_weeks`

교체·제거:

- `src/app/data/types.ts`의 급여 `MonthlyClose`
- `src/app/data/payroll-store.tsx`의 direct 월 마감 읽기·쓰기
- `server/bff/payroll-worker.mjs`의 월 문서 생성
- `PortalPayrollPage`, `AdminPayrollPage`, `PortalLayout`의 기존 월 마감 흐름

신규 최소 범위:

- JVM 월 결산·재오픈 명령
- BFF 캐시플로우 대시보드 조회 조합
- 캐시플로우 월 결산 타입·조회 UI
- Firestore rules/index와 Stage overwrite 스크립트

## 12. 성공 기준과 QA

- 프로젝트 A의 lease가 프로젝트 B를 막지 않는다.
- 사용자 B는 사용자 A가 편집 중인 프로젝트를 읽을 수 있지만 수정할 수 없다.
- 같은 사용자 인계 후 이전 탭 저장은 fence로 거절된다.
- 읽기 모드 선택 후 같은 차단 팝업이 반복되지 않는다.
- 30분 만료 후 lease만 풀리고 draft는 복구된다.
- PM 최종저장 후 월이 `CLOSED`가 되고 Admin/Finance에 snapshot이 보인다.
- 닫힌 월의 모든 수정은 거절된다.
- 승인된 재오픈만 경고 횟수를 정확히 한 번 증가시킨다.
- 미확인 항목이나 확인되지 않은 빈 항목이 하나라도 있으면 결산이 거절된다.
- 시트 또는 JVM 오류 시 반쪽 결산이 생기지 않는다.
- 브라우저의 canonical collection 직접 쓰기는 Firestore Rules가 거절한다.
- 원본 workbook의 작업 전후 hash가 같다.
- `시트값 불러오기`만 존재하고 브라우저·BFF 어디에도 시트 쓰기 요청이 없다.
- 요약과 차이는 미래 주차를 제외하고 현재 주차까지만 서버가 계산한다.
- 전체 주차 합계와 BO control total의 불일치가 조용히 덮이지 않는다.
- 상세 표에 `전체` 보기가 없고 연도 이동·월 선택·월 결산이 동작한다.
- 모든 검증과 배포는 Stage에서만 수행한다.
- Stage QA 기준일은 월 결산 가능 여부와 다음 달 10일 초과 판정에만 적용하고, lease·저장·감사 시각은 실제 서버 시간을 유지한다.
- 결산 snapshot에는 KST 서버 기준 `evaluatedBusinessDate`를 남긴다.
- Stage가 아닌 JVM에 QA 기준일이 설정되면 서버 시작을 거절한다.

검증 명령:

```bash
npx vitest run <관련 BFF·Frontend 테스트>
mvn -f server/jvm-weekly-api/pom.xml test
npm run bff:test:integration
npm run build
```

현재는 docs-only 단계이므로 브라우저 QA는 구현 단계에서 수행한다.

## 13. 미정

1. 여러 입금 회차와 프로젝트 등록 회차의 자동 대조 식별 규칙
2. 미입금 총액 기준: 계약금액, 예정액 합계, 세금계산서 발행액 중 무엇인지
3. `C5/C11`의 `2027년` 표기와 2026-01~2027-03 날짜 헤더 불일치를 원본에서 언제 정정할지

미정 항목은 화면에 `미정`으로 표시하고 임의 계산하지 않는다.

## 14. 작업 경계

- Always: Stage만 사용, 서버 trust boundary 검증, 감사로그·멱등성, 원본 workbook hash 확인
- Ask first: Live 마이그레이션·배포, 여러 회차 규칙 확정, 미입금 산식 확정
- Never: 원본 시트 수정, 프론트 권한 판정, 브라우저 canonical write, 자동 최종저장, 전역 lock
- Stage DB overwrite 직전 `monthly_closes`를 export한다.
