# Admin Ledger Detail

- route: `/projects/:projectId/ledgers/:ledgerId`
- primary users: admin, finance
- status: active
- last updated: 2026-04-14

## Purpose

개별 원장 상세를 보고 탭별로 정산 관련 데이터를 검토하는 관리자 화면이다.

## Current UX Summary

- 원장 수준의 상세 데이터를 본다.
- 탭 전환으로 관련 정보 묶음을 분리해서 확인한다.

## Current Feature Checklist

- [x] 거래 KPI 카드 확인 가능
- [x] 거래처/메모 검색 가능
- [x] 거래 추가 dialog 사용 가능
- [x] 제출/승인/반려 상태 처리 가능
- [x] 상세 side panel 확인 가능
- [x] 메모/코멘트 기록 가능
- [x] 프로젝트 단위 정산 문맥에서 원장 검토 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 원장 상세는 캐시플로/예산/증빙 흐름의 하위 작업면이다.

## Related Files

- `src/app/components/ledgers/LedgerDetailPage.tsx`

## Related Tests

- 현재 원장 상세 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 세부 원장 오류나 정산 검토 이슈가 들어오면 함께 확인해야 하는 화면이다.

## Next Watch Points

- 원장 탭 구조가 실제 정산 운영 흐름과 맞는지
