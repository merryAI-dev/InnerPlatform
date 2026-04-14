# Admin Personnel Changes

- route: `/personnel-changes`
- primary users: admin, 인사 변경 검토 담당자
- status: active
- last updated: 2026-04-14

## Purpose

인력변경 요청과 관련 문서를 검토하고 승인 전 확인을 수행하는 관리자 화면이다.

## Current UX Summary

- 문서 미리보기와 버튼 액션이 함께 제공된다.
- 요청 건을 보면서 증빙/첨부를 검토한다.

## Current Feature Checklist

- [x] 인력변경 요청 검색 가능
- [x] before/after 비교 가능
- [x] 첨부 문서 미리보기 가능
- [x] 첨부 문서 다운로드 가능
- [x] 승인/반려/수정요청 가능
- [x] 미제출 서류 KPI 확인 가능
- [x] 관련 사업 링크 확인 가능
- [x] 인사 운영 검토 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- approvals와 가까운 화면이지만 문서 검토 깊이가 더 크다.

## Related Files

- `src/app/components/koica/PersonnelChangePage.tsx`

## Related Tests

- 현재 인력변경 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 인력변경 승인 대기 운영 흐름과 함께 본다.

## Next Watch Points

- 문서 미리보기 조작과 승인 흐름이 계속 안정적인지
