# Portal Change Requests

- route: `/portal/change-requests`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 인력변경 등 요청을 만들고 상태를 확인하는 화면이다.

## Current UX Summary

- 요청 목록과 alert를 본다.
- dialog를 통해 새 요청을 만든다.

## Current Feature Checklist

- [x] 새 인력변경 요청 draft 생성 가능
- [x] HR 알림에서 바로 요청 시작 가능
- [x] 알림 확인/닫기/다시보기 가능
- [x] 상태 KPI 확인 가능
- [x] 요청 제출 confirm 가능
- [x] 상세 timeline 확인 가능
- [x] 프로젝트 설정/인력 화면과 연결 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-02-25] auth/project selection flow 반영으로 안정성이 보강됐다.

## Known Notes

- 인력 알림과 요청 생성이 같이 묶여 있다.

## Related Files

- `src/app/components/portal/PortalChangeRequests.tsx`

## Related Tests

- 현재 변경 요청 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 인력변경 운영 요청이 들어오면 portal과 admin personnel-changes를 같이 봐야 한다.

## Next Watch Points

- 요청 생성 dialog와 alert 흐름이 계속 맞는지
