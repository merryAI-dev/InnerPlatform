## Goal

포털 시작 선택 카드가 실제 다음 화면으로 이동하도록 복구한다.

## Symptoms

- `기존 사업 선택`을 눌러도 사업 선택/배정 화면으로 가지 않음
- `증빙 업로드만 할게요`를 눌러도 업로드/주간 입력 화면으로 가지 않음
- `새 사업 등록`을 눌러도 사업 등록 화면으로 가지 않음

## Investigation Focus

- `PortalLayout`의 fallback 선택 화면과 standalone bypass route 계약 확인
- `/portal/project-select`, `/portal/project-settings`, `/portal/weekly-expenses`, `/portal/register-project`가 실제로 bypass 되는지 확인
- 클릭 후 pathname 변경 여부와 후속 redirect 여부를 모두 확인

## Deliverables

- target route 정렬
- layout guard 정렬
- 회귀 테스트 추가
