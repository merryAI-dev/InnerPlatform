# Shared Board Post

- route: `/board/:postId`, `/portal/board/:postId`
- primary users: admin, PM, 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

게시글 상세를 읽고 반응, 댓글, 수정/삭제 같은 세부 상호작용을 수행하는 화면이다.

## Current UX Summary

- 본문과 메타데이터를 읽는다.
- 댓글과 답글 상호작용을 지원한다.
- 본인 글에 한해 수정/삭제를 수행한다.

## Current Feature Checklist

- [x] 게시글 상세 조회 가능
- [x] 추천/비추천 반응 가능
- [x] 댓글 작성 가능
- [x] 답글 작성 가능
- [x] 본인 글 수정/삭제 가능
- [x] not found 상태 처리 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 목록 문서와 달리 CRUD와 반응/댓글 상호작용이 핵심이다.

## Related Files

- `src/app/components/board/BoardPostPage.tsx`
- `src/app/data/board-store.tsx`

## Related Tests

- 현재 게시글 상세 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 게시판 moderation 정책이 생기면 가장 먼저 영향받는 문서다.

## Next Watch Points

- 수정/삭제 권한과 댓글 상호작용이 admin/portal 양쪽에서 계속 일치하는지
