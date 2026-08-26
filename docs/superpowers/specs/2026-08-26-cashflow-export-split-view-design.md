# Cashflow Export Split View Design

## 목적

`/cashflow/export`에서 여러 사업의 운영 상태를 비교하다가 한 사업을 확인해도 목록·필터·다운로드 문맥을 잃지 않게 한다. 최근 두 주의 주정산은 행 높이를 줄여 한눈에 비교하고, 사업 상세는 같은 화면 오른쪽에서 확인한다.

## 선택한 접근

세 가지 접근을 비교했다.

1. **URL 동기화 50:50 분할 패널 (선택)**: 같은 route의 query에 선택 사업을 기록하고 기존 사업 상세 컴포넌트를 오른쪽에 마운트한다. 뒤로가기·새로고침을 지원하면서 왼쪽 React 상태를 보존한다.
2. 로컬 state drawer: 구현은 조금 작지만 새로고침과 뒤로가기로 패널 상태를 복원할 수 없다.
3. modal overlay: 상세가 목록을 가려 사용자가 요청한 반반 비교가 되지 않는다.

URL 동기화 분할 패널이 예측 가능성과 변경 범위의 균형이 가장 좋다.

## 화면 구조

데스크톱은 현재 콘텐츠 영역을 정확히 두 열로 나눈다.

```text
┌──────────────────────────────┬──────────────────────────────┐
│ 내보내기 설정과 운영 현황     │ 선택 사업 상세               │
│                              │ [사업명]              [닫기] │
│ 8월 5주차 │ 9월 1주차        │ 기존 CashflowProjectSheet    │
│ 사업명 ...              보기 │                              │
└──────────────────────────────┴──────────────────────────────┘
```

- 왼쪽은 기존 페이지이며 state와 스크롤을 유지한다.
- 오른쪽은 독립 스크롤 영역이다. 패널을 열 때 비교 섹션으로 이동한다.
- 1024px 미만에서는 오른쪽 패널이 화면 전체를 덮고 명시적인 닫기 버튼을 제공한다.
- 최근 두 주 카드는 표의 주정산 셀 안에서 항상 `grid-cols-2`로 배치한다. 표 자체가 이미 가로 스크롤을 제공하므로 카드를 다시 세로로 접지 않는다.

## 상태와 URL

- query key는 `project` 하나만 사용한다.
- `사업 보기`는 현재 search params를 보존하면서 `project=<id>`를 추가한다.
- 닫기는 `project`만 제거한다. 브라우저 뒤로가기도 같은 결과를 낸다.
- query의 project가 현재 `projects`에 없으면 fail-close하여 패널을 마운트하지 않고 query를 제거한다.
- 필터, 선택 사업, 다운로드 기간은 기존 component state에 남고 route가 바뀌지 않으므로 유지된다.

## 컴포넌트 경계

- `CashflowExportPage.tsx`: query를 소유하고 2열 레이아웃, 열기·닫기, 최근 주차 2열 배치만 담당한다.
- `CashflowExportProjectPane.tsx`: 선택 사업을 받아 `CashflowWeekProvider` 안에서 기존 `CashflowProjectSheet`를 마운트한다. 패널이 닫히면 컴포넌트 전체가 unmount된다.
- `CashflowProjectSheet.tsx`: 변경하지 않는다. 사업 상세의 기존 데이터·권한·mutation 계약을 그대로 사용한다.

새 endpoint, 새 저장소 read, 새 계산은 없다. 패널이 열린 동안 기존 사업 상세가 원래 route에서 하던 요청만 수행한다.

## 시각 방향

기존 경영기획실 화면의 stone/zinc 운영 도구 톤을 유지한다. 새 장식이나 색상은 만들지 않는다.

- Color: Zinc `#18181B`, Stone `#78716C`, Border `#E7E5E4`, Paper `#FFFFFF`, Focus `#A8A29E`.
- Type: 현재 애플리케이션 본문·데이터 글꼴을 그대로 사용하고, 숫자는 기존 tabular style을 유지한다.
- Signature: 두 화면 사이의 얇고 명확한 경계와 고정된 사업 제목 bar가 “목록을 놓치지 않고 상세를 펼친다”는 동작을 표현한다.

독창성을 위해 새 디자인 언어를 얹기보다, 이 업무 화면에만 필요한 **운영 원장 펼침** 동작 하나에 시각적 강조를 집중한다.

## 접근성과 오류

- 오른쪽 패널은 `aside`와 명확한 accessible name을 가진다.
- 닫기 버튼은 사업명을 포함한 accessible label을 사용한다.
- Escape는 패널만 닫고 페이지를 떠나지 않는다.
- 데스크톱 양쪽 영역과 모바일 패널은 키보드로 스크롤할 수 있다.
- 유효하지 않은 project query는 빈 상세나 오류 화면을 잠깐 노출하지 않는다.
- 상세 내부 오류는 기존 `CashflowProjectSheet`의 표현을 그대로 따른다.

## 검증

- shell/unit: 주차 grid, query open/close, 선택 시에만 provider mount, invalid project fail-close.
- browser: URL 유지, 50:50 폭, 두 주 카드의 같은 y좌표, 뒤로가기, 새로고침 복원, 375px 전체 화면, Escape/닫기.
- regression: 다운로드 payload와 파일명, weekly-overview/settlement request count, 권한 없는 사용자의 zero request.
- frozen diff: BFF, JVM, workbook, coordinates, sheet sync, Firebase rules/indexes는 변경 0.
