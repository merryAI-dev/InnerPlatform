# Admin Project Detail

- route: `/projects/:projectId`
- primary users: admin, finance, 프로젝트 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

개별 사업의 기본 정보, 운영 상태, 연결된 작업면 진입을 확인하는 상세 화면이다.

## Current UX Summary

- 사업 핵심 메타데이터를 요약해서 본다.
- 목록으로 돌아가거나 수정 화면으로 이동한다.
- 연결된 정산/원장 흐름으로 이어진다.

## Current Feature Checklist

- [x] 사업 핵심 정보 카드 확인 가능
- [x] 목록으로 복귀 가능
- [x] 수정 화면 진입 가능
- [x] 시작/종료 상태 변경 가능
- [x] 휴지통 이동/복구 가능
- [x] 원장 목록 확인 가능
- [x] 원장 생성 dialog 사용 가능
- [x] 원장 상세 이동 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-09] admin project surface trim 이후 상세 운영 흐름이 정리됐다.

## Known Notes

- 상세 화면은 자체 입력보다 다른 작업면으로 이동시키는 역할이 크다.

## Related Files

- `src/app/components/projects/ProjectDetailPage.tsx`

## Related Tests

- 현재 상세 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 프로젝트명/기관명/재무 정보 변경 이슈가 들어오면 상세와 수정 화면을 같이 봐야 한다.

## Next Watch Points

- 상세 화면에서 제공하는 링크가 실제 후속 작업면과 맞는지
