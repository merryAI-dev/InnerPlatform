# Patch Notes Wiki Agent Guide

## Mission

이 디렉터리는 화면 단위 누적 패치노트 위키다. raw truth는 코드, 테스트, PR, 커밋이고 이 위키는 운영자가 최근 변화와 맥락을 빠르게 읽기 위한 중간 계층이다.

## Directory Contract

- `index.md`: 전체 탐색 진입점
- `log.md`: append-only 시간순 기록
- `pages/*.md`: 화면 단위 누적 문서
- 각 `pages/*.md`는 `현재 구현 체크리스트`를 포함한다.

## Authoring Rules

1. 기능 추가나 버그 수정이 특정 화면의 UX, 권한, 데이터 흐름, 운영 해석을 바꾸면 대응 `pages/*.md`를 갱신한다.
2. 하나의 변경이 여러 화면에 걸치면 대응 화면 문서를 각각 갱신하고 `log.md`에 공통 서사를 남긴다.
3. 새 페이지 문서를 만들면 `index.md`를 같은 커밋에서 갱신한다.
4. 문장은 마케팅 문구가 아니라 사실 중심 운영 기록으로 쓴다.
5. 가능하면 관련 파일, 테스트, QA 문맥, 대표 커밋을 함께 남긴다.
6. 한 문서에 코드를 길게 복제하지 않는다. 구현 근거는 파일 경로와 테스트 경로로 연결한다.
7. 체크리스트는 개발 구현 단위가 아니라 사용자가 체감하는 기능 단위로 쓴다.
8. 기능이 추가되거나 제거되면 `Recent Changes`뿐 아니라 `Current Feature Checklist`도 같이 갱신한다.
9. mapped surface나 정책 source of truth가 바뀌면 pre-commit hook이 대응 `pages/*.md`와 `log.md` staging을 요구한다.

## Page Template

모든 `pages/*.md`는 아래 메타데이터를 유지한다.

- `route`
- `primary users`
- `status`
- `last updated`

그리고 최소 섹션은 아래를 유지한다.

- `Purpose`
- `Current UX Summary`
- `Current Feature Checklist`
- `Recent Changes`
- `Known Notes`
- `Related Files`
- `Related Tests`
- `Related QA / Ops Context`
- `Next Watch Points`

## Update Workflow

### 기능/버그 수정 후

1. 영향 화면 식별
2. 대응 `pages/*.md` 갱신
3. `log.md` append
4. 새 seed가 생기면 `index.md` 갱신
5. 사용자 체감 기능이 바뀌었다면 체크리스트를 먼저 고친다.
6. hook이 막히면 우회보다 대응 page 문서와 `log.md`를 먼저 갱신한다.

### QA 입력 후

1. QA 이슈가 귀속되는 화면 문서를 찾는다.
2. `Related QA / Ops Context` 또는 `Next Watch Points`에 남긴다.
3. 코드 반영이 끝나면 `Recent Changes`와 `log.md`에 결과를 적는다.

### Lint 기준

- 최근 크게 바뀐 화면인데 page 문서가 없는가
- `last updated`가 너무 오래된 핵심 화면이 있는가
- `Related Files`가 현재 코드와 어긋나는가
- 동일한 변경이 여러 문서에서 충돌되게 서술되는가
- 체크리스트가 현재 구현 상태와 어긋나지 않는가

## Naming Rules

- 파일명은 kebab-case
- route/공간 의미가 드러나도록 `portal-*`, `admin-*`, `shared-*` prefix 사용
- 도메인 문서보다 화면 문서를 우선 생성
