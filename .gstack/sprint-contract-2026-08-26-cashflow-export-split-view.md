# Sprint Contract: 캐시플로 내보내기 사업 분할 보기
**날짜:** 2026-08-26
**예상 소요:** 2~3시간
**상태:** APPROVED

## 구현할 것

- `/cashflow/export`의 사업별 최근 2주 주정산 카드를 세로 2개가 아니라 가로 2개로 표시한다.
- `사업 보기`를 눌러도 내보내기 페이지를 떠나지 않고, 데스크톱에서 현재 화면과 사업 상세를 50:50으로 표시한다.
- 선택 사업은 URL query에 남겨 뒤로가기·새로고침·직접 링크가 같은 패널 상태를 복원한다.
- 모바일에서는 사업 상세를 전체 화면 패널로 표시하고 닫기 동작을 제공한다.
- 사업 상세는 기존 `CashflowProjectSheet`와 기존 `CashflowWeekProvider`를 선택 시점에만 재사용한다.

## 성공 기준

- [ ] 각 사업 행의 두 주차 카드가 같은 행에 나란히 표시된다.
- [ ] `사업 보기` 클릭 후 pathname은 `/cashflow/export`로 유지되고 선택 사업 query만 추가된다.
- [ ] 1024px 이상에서 내보내기 화면과 사업 상세가 각각 절반을 차지한다.
- [ ] 375px에서 사업 상세가 전체 화면으로 열리고 닫기 버튼과 Escape로 닫힌다.
- [ ] 브라우저 뒤로가기가 패널을 닫고, 패널을 열기 전 필터·선택·스크롤 상태를 유지한다.
- [ ] 패널이 닫혀 있을 때 사업 상세 provider와 상세 데이터 요청이 발생하지 않는다.
- [ ] 존재하지 않거나 현재 명부에 없는 project query는 패널을 열지 않고 URL에서 제거된다.
- [ ] 기존 다운로드 요청 body·파일명·XLSX 결과와 운영 현황 BFF 요청 수가 변하지 않는다.

## 실패 기준

- [ ] `사업 보기`가 `/cashflow/projects/:id`로 전체 페이지 이동한다.
- [ ] 패널을 닫아도 상세 데이터 요청이나 provider가 백그라운드에 남는다.
- [ ] 내보내기 표의 주정산·P/A·시트 시각을 새로 계산하거나 다른 저장소에서 읽는다.
- [ ] 다운로드 route, workbook mapper, cashflow coordinates, JVM, sync, Firestore rules/indexes가 변경된다.
- [ ] 데스크톱 분할에서 한쪽이 키보드로 스크롤되지 않거나 모바일에서 닫을 수 없다.

## 범위 밖

- 사업 상세 화면 내부 기능·데이터 계약 변경
- 새 API/BFF endpoint 또는 Firestore 조회 경로 추가
- 캐시플로 시트 좌표·동기화·계산·엑셀 양식 변경
- 다른 캐시플로 허브의 `사업 보기` 동작 변경

## 평가 방법

- `CashflowExportPage`와 새 분할 패널의 unit/shell 테스트를 RED→GREEN으로 실행한다.
- API-enabled Playwright에서 2주 가로 배치, URL·뒤로가기·새로고침·모바일 닫기·다운로드 회귀를 검증한다.
- 1440px와 375px에서 키보드 포커스·스크롤·console error를 확인한다.
- typecheck, production build, 관련 Vitest, cashflow export Playwright를 실행한다.
- 독립 QA가 intent/data-path, implementation, verification, regression gate와 UI 4축 점수를 판정한다.
