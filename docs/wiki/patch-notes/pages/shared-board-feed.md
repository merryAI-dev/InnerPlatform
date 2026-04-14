# Shared Board Feed

- route: `/board`, `/portal/board`
- primary users: admin, PM, 포털 사용자
- status: active
- last updated: 2026-04-14

## Purpose

전사 게시판의 목록 화면으로, 정렬/검색/필터와 새 글 작성을 제공한다.

## Current UX Summary

- HOT, 최신, TOP, 활동 기준으로 정렬한다.
- 제목, 본문, 태그, 채널 기준 탐색을 지원한다.
- 목록에서 상세 글로 이동한다.

## Current Feature Checklist

- [x] HOT/최신/TOP/활동 정렬 가능
- [x] 제목/본문/태그 검색 가능
- [x] 채널 필터 가능
- [x] 새 글 작성 dialog 사용 가능
- [x] 게시글 카드에서 상세 이동 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- admin와 portal이 같은 게시판 목록 화면을 공유한다.

## Related Files

- `src/app/components/board/BoardFeedPage.tsx`
- `src/app/data/board-store.tsx`

## Related Tests

- 현재 게시판 목록 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 전사 공지/게시판 운영 정책이 바뀌면 함께 보는 문서다.

## Next Watch Points

- admin와 portal 양쪽 진입에서 게시판 기능이 계속 동일한지
