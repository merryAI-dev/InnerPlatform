# Admin HR Announcements

- route: `/hr-announcements`
- primary users: admin, HR 운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

사내 공지를 등록, 수정, 게시하는 관리자 화면이다.

## Current UX Summary

- 공지 목록을 보고 새 공지를 작성한다.
- 버튼과 dialog를 통해 공지 작업을 수행한다.

## Current Feature Checklist

- [x] 공지 목록 확인 가능
- [x] 새 공지 작성 가능
- [x] 직원 선택과 일정/내용 입력 가능
- [x] 공지별 alert 목록 확인 가능
- [x] 미확인 alert acknowledge 가능
- [x] change request 생성 상태 확인 가능
- [x] resolved 처리 가능
- [x] HR 운영 공지 surface로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 포털 대시보드에서 보는 공지와 관리면 역할이 다르다.

## Related Files

- `src/app/components/hr/AdminHrAnnouncementPage.tsx`

## Related Tests

- 현재 HR 공지 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 전사 공지 운영 변경이 있으면 함께 보는 관리자 문서다.

## Next Watch Points

- 공지 생성/수정 dialog 흐름이 계속 유지되는지
