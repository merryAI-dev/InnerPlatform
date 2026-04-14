# Admin Audit Log

- route: `/audit`
- primary users: admin, 감사/운영 담당자
- status: active
- last updated: 2026-04-14

## Purpose

감사 로그를 조회하고 필요 시 CSV로 내보내는 관리자 화면이다.

## Current UX Summary

- 로그 목록과 필터를 통해 이벤트를 본다.
- CSV export 버튼으로 내보낼 수 있다.

## Current Feature Checklist

- [x] 감사 로그 조회 가능
- [x] 검색 가능
- [x] 액션 필터 가능
- [x] 대상 필터 가능
- [x] 날짜별 timeline 확인 가능
- [x] CSV export 가능
- [x] 운영 감사 추적 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-03-18] audit log CSV export가 추가됐다.

## Known Notes

- 권한/정산/설정 변경 추적 시 같이 보는 화면이다.

## Related Files

- `src/app/components/audit/AuditLogPage.tsx`

## Related Tests

- 현재 감사 로그 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 운영 변화의 근거를 사후 확인할 때 보는 관리자 문서다.

## Next Watch Points

- CSV export와 필터 결과가 계속 맞는지
