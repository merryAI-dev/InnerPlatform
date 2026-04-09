# Admin Cashflow Export Server-Side Design

## Goal
- `admin/finance` 전용 캐시플로 추출 화면을 운영툴형으로 재편한다.
- 엑셀 workbook 생성 책임을 브라우저에서 BFF로 옮겨 권한 검사와 다운로드 일관성을 확보한다.
- 기존 사업별 다운로드와 전체사업 다운로드가 같은 export contract를 사용하게 만든다.

## UI Direction
- `/cashflow`는 분석 화면이 아니라 `운영툴형 단일 화면`으로 유지한다.
- 상단에는 대상 범위, 기간, 출력 형식, 다운로드 액션만 둔다.
- 중간에는 대상 사업 수, 업데이트 사업 수, 미업데이트 사업 수를 짧게 요약한다.
- 하단에는 추출 대상 사업 테이블과 사업 바로가기만 남긴다.
- 톤은 `slate + teal` 기반의 실무형 밀도 높은 화면으로 맞춘다.

## Download Architecture
- 프론트는 추출 조건만 만들고 BFF endpoint에 전달한다.
- BFF는 `cashflow:export` 권한을 다시 검사하고 workbook을 생성해 `.xlsx` binary를 응답한다.
- 프론트는 BFF가 활성화된 환경에서는 server-side export를 사용하고, 비활성 환경에서는 기존 local workbook fallback을 유지한다.

## API Contract
- Endpoint: `POST /api/v1/cashflow-exports`
- Request:
  - `scope`: `all | single`
  - `projectId?`: scope가 `single`일 때 필수
  - `startYearMonth`
  - `endYearMonth`
  - `variant`: `single-project | combined | multi-sheet`
- Response:
  - `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - `Content-Disposition` filename 포함

## Data Source
- BFF는 `orgs/{tenantId}/projects`, `orgs/{tenantId}/cashflowWeeks`를 읽어 workbook을 만든다.
- 월별 주차는 항상 5-slot으로 고정하고, 존재하지 않는 5주차는 빈 칸으로 둔다.
- export source of truth는 `CashflowWeekSheet`다.
- transaction은 workbook 메타데이터에 필수적이지 않으므로 이번 단계에서는 조회하지 않는다.

## RBAC
- `cashflow:export`는 `admin`, `finance`만 허용한다.
- PM/viewer는 `/cashflow` 접근이 막혀 있고, BFF에서도 동일 권한을 재검사한다.

## Scope
- 포함:
  - `/cashflow` 운영툴형 UI 재편
  - BFF export route 추가
  - 프론트 BFF 호출 추가
  - 기존 사업별 다운로드의 BFF 우선 전환
- 제외:
  - 캐시플로 조회 데이터를 전부 BFF 기준으로 재구성
  - 재경 후처리용 추가 대시보드
  - 장기 보관용 export job queue
