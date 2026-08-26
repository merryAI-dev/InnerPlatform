# 캐시플로 내보내기 운영 현황 표 설계

## 배경

`/cashflow/export`의 다운로드 대상 표는 실제 주정산 상태가 아니라 `cashflow_weeks.updatedAt`을 최근 목요일과 비교해 `업데이트됨/미업데이트`를 만든다. 최근 업데이트 시각도 같은 주차 문서에서 가져오며, 누적 Projection-Actual은 별도 strict 조회가 mirror 상태와 revision이 맞지 않으면 `확인 불가 · 다시 조회`를 표시한다.

다운로드 파일은 이미 `cashflow_sheet_mirrors`의 저장값을 정확히 옮기는 경로로 정렬됐다. 화면도 계산이나 추론을 추가하지 않고 운영 정본을 그대로 보여줘야 한다.

## 목표

1. 다운로드 대상 사업 표를 운영자가 바로 읽을 수 있는 최신 업무 용어로 바꾼다.
2. 월요일에도 직전 완료 내역이 사라지지 않도록 직전 주차와 현재 주차를 함께 보여준다.
3. 주정산 상태·제출 시각·승인 시각은 기존 JVM weekly-overview 결과를 그대로 사용한다.
4. 누적 Projection-Actual과 마지막 시트 불러오기 시각은 저장된 mirror를 그대로 사용한다.
5. 엑셀 생성, 고정 좌표, 시트 동기화, JVM 상태 전이, Firestore rules는 변경하지 않는다.

## 화면 구조

표 열은 다음 순서로 고정한다.

```text
사업명 | 조직장 | 담당자 | 주정산 최근 2주 | 누적 Projection-Actual | 시트 불러온 시각 | 이동
```

`주정산 최근 2주` 셀에는 오늘(Asia/Seoul)이 속한 현재 finance week와 그 직전 finance week를 오래된 순서부터 두 줄로 표시한다.

```text
8월 4주차   승인 완료
  실무자 제출 완료  8/20 11:51
  조직장 승인 완료  8/20 15:45

8월 5주차   조직장 승인 필요
  실무자 제출 완료  8/25 16:48
  조직장 승인 완료  —
```

- 월 경계에서는 `8월 5주차 / 9월 1주차`처럼 두 달을 이어 표시한다.
- 완료된 주차나 활동이 있는 주차만 고르지 않는다. 현재 주차가 미완료여도 그대로 보여준다.
- 상태 라벨은 `주정산 이전`, `조직장 승인 필요`, `승인 완료`로 기존 주정산 화면과 일치시킨다.
- 제출·승인 시각이 없으면 업무 의미가 분명한 `제출 전`, `승인 전`을 표시한다.
- 별도 재조회 링크나 deadline 추론은 추가하지 않는다.

조직장과 담당자는 프로젝트 UID를 People 명부에 연결한 기존 주정산 표시 규칙을 재사용한다. UID 연결이 없으면 이름을 추측하거나 legacy 문자열로 대체하지 않고 `연결 필요`를 표시한다.

## 데이터 정본과 요청

### 주정산 최근 2주

- 두 주 모두 canonical JVM 정산 상태를 사용한다. 현재 주차가 속한 월은 기존 `POST /api/v1/cashflow/weekly-overview` 한 번으로 읽는다.
- 직전 주차가 이전 달에 속할 때만 같은 canonical JVM 상태 경로인 `POST /api/v1/cashflow/settlement-statuses/batch`를 한 번 더 호출한다.
- 프로젝트가 100개를 넘으면 기존 API 상한에 맞춰 100개씩 나눈다.
- 응답은 `projectId + yearMonth + WEEK_n`으로만 연결하며 가장 최근 제출 시각 등을 기준으로 주차를 다시 고르지 않는다.
- 최근 두 주는 선택한 엑셀 연도나 전역 cashflow month가 아니라 `getSeoulTodayIso()`와 공용 finance-week 규칙만으로 정한다.

### 시트 mirror 현황

weekly-overview의 기존 `projectionActualSummary` 필드를 실제 mirror 저장값으로 채우고, 같은 item에 `sheetCapturedAt`을 추가한다. 응답 의미가 바뀌므로 overview version은 `4`로 올린다.

- `projectionActualSummary`: `cashflow_sheet_mirrors/{projectId}.sheetFacts.projectionActualDifferences`의 저장값을 기존 표시 DTO로 매핑한다.
- `sheetCapturedAt`: mirror의 `capturedAt`만 사용한다.
- 두 값은 반드시 동일한 mirror document read에서 만든다. `updatedAt`, `lastRefreshAttemptAt`, 현재 시각으로 시각을 대체하지 않는다.
- `lastRefreshAttemptAt`은 실패한 시도까지 포함하므로 사용하지 않는다.
- overview용 mirror 읽기는 기존 strict P/A batch의 `FRESH`, `sourceRevision === appliedSourceRevision` 표시 제한을 적용하지 않는다. 저장된 최신 mirror가 있으면 그대로 보여준다.
- 서울 기준 현재 finance week 이하의 유효한 `(yearMonth, weekNo)` 중 가장 최신 행 하나의 `amount`만 선택한다. 금액을 합산하거나 다른 저장값에서 역산하지 않는다.
- mirror의 `projectId`가 요청 projectId와 다르거나, 배열에 malformed 행 또는 중복 `(yearMonth, weekNo)`가 있거나, 미래 행만 있으면 summary는 `null`이다. 0으로 보정하거나 임의의 중복 행을 고르지 않는다.
- mirror가 없거나 필요한 저장 행이 없으면 다운로드나 화면을 막지 않고 `시트 저장값 없음` 또는 `불러온 기록 없음`으로 표시한다.
- JVM overview HTTP가 성공하면 요청한 projectId 전체의 scope 인가가 통과한 것이다. 그 뒤 요청 projectId 전체를 mirror 대상으로 삼으며, `STATUS_UNAVAILABLE`은 상태 저장소의 부분 실패일 뿐 mirror 제외 조건으로 사용하지 않는다. 권한 판단과 mirror read를 병렬로 시작하지 않는다.
- production Firestore에서는 요청 chunk당 bounded `getAll` 한 번으로 mirror를 읽는다. 프로젝트별 `get()` N+1을 만들지 않는다.

기존 strict P/A batch endpoint와 이를 사용하는 다른 화면은 변경하지 않는다.

## 오류·로딩·보안

- 첫 조회 중에는 두 주차와 mirror 값을 `확인 중`으로 표시한다.
- 한 달의 주정산 요청만 실패하면 해당 월의 주차만 `주정산 정보를 불러오지 못함`으로 표시하고 다른 주차와 mirror 값은 유지한다.
- status 오류는 이미 읽은 mirror summary를 지우지 않고, mirror 오류도 이미 읽은 status를 지우지 않는다.
- 프로젝트 필터나 인증 scope가 바뀌면 이전 scope의 overview 결과를 새 행에 게시하지 않는다.
- BFF는 기존 role 검사와 project scope 검사를 거친 뒤 mirror를 읽는다. 프론트에서 Firestore를 직접 읽지 않는다.
- 클라이언트는 overview version, item projectId, settlementStatuses의 projectId/yearMonth, projection summary projectId, `sheetCapturedAt` 형식을 검증하고 foreign/cross-wired 응답을 거부한다.
- technical copy인 `생성 기준 / BFF 서버의 최신 현금흐름 데이터`와 목요일 기반 상태 설명은 삭제한다.

## 변경 경계

변경한다.

- weekly-overview의 additive mirror read model
- BFF client DTO
- 최근 두 finance week 선택과 응답 join을 담당하는 순수 프론트 helper
- `/cashflow/export`의 표, 로딩·오류 표시, API orchestration
- 관련 unit, BFF route, browser tests

변경하지 않는다.

- `server/bff/cashflow-coordinates.mjs`
- cashflow export workbook 생성·필터·정렬·파일명
- Google Sheet refresh/apply/publish 경로
- JVM 정산 상태 저장·전이·deadline 판단
- Firestore/Storage rules와 indexes
- 주정산 페이지의 상태 변경 UI

## 검증

1. 8월 5주차 중에는 8월 4·5주차가 표시된다.
2. 9월 1주차에는 8월 마지막 finance week와 9월 1주차가 표시된다.
3. 8월 31일 raw week 6은 8월 finance week 5로 병합되어 8월 4·5주차를 표시하고, 1월 1일에는 전년 12월 마지막 finance week와 1월 1주차를 표시한다.
4. WAITING/PENDING/COMPLETED와 submittedAt/approvedAt가 주차별로 섞이지 않는다.
5. stale 또는 revision-mismatch mirror도 overview에서는 저장된 P/A 값과 capturedAt을 보여주며 strict batch endpoint의 기존 동작은 유지한다.
6. absent, malformed, duplicate, future-only, foreign mirror는 `null`이고 0이 아니다.
7. 0/1/61/100/101개 프로젝트에서 API chunk와 Firestore batch read 횟수가 bounded하다.
8. mirror 없음은 다운로드를 막거나 0을 발명하지 않는다.
9. 표는 조직장·담당자를 People UID 기준으로 표시한다.
10. P/A batch 호출, cashflow_weeks 기반 목요일 계산, `확인 불가 · 다시 조회`가 export 페이지 네트워크와 DOM에서 사라진다.
11. 실제 브라우저에서 표 상태를 확인한 뒤 같은 화면의 다운로드가 기존 request payload와 파일명을 유지한다.
12. 375px에서는 표 컨테이너만 가로 스크롤되고 두 주차의 텍스트와 상태를 키보드/스크린리더로 읽을 수 있다.
