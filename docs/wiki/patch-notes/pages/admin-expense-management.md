# Admin Expense Management

- route: `/expense-management`
- primary users: admin, finance
- status: active
- last updated: 2026-04-14

## Purpose

사업비 세트와 기간, 운영용 정산 묶음을 관리하는 관리자 화면이다.

## Current UX Summary

- 관리 세트 목록을 보고 새 세트를 만든다.
- 기간과 제목 같은 운영 메타데이터를 관리한다.

## Current Feature Checklist

- [x] 세트 검색/상태/프로젝트 필터 가능
- [x] 새 관리 세트 생성 가능
- [x] 항목 추가/수정 dialog 사용 가능
- [x] 제출/승인/반려 상태 처리 가능
- [x] 반려 사유 입력 가능
- [x] 카드/현금 등 지급수단 표시 확인 가능
- [x] 제목/기간 등 운영 메타데이터 관리 가능
- [x] 관리자 관점의 사업비 운영 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- portal weekly expense와 달리 관리 단위 자체를 만드는 화면이다.

## Related Files

- `src/app/components/expense/ExpenseManagementPage.tsx`

## Related Tests

- 현재 사업비 관리 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업비 입력 구조와 묶음 설계가 바뀌면 영향을 받는다.

## Next Watch Points

- 세트 생성/편집 메타데이터가 실제 운영 화면과 계속 일치하는지
