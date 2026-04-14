# Portal Project Edit

- route: `/portal/edit-project`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 자기 사업 정보를 편집하거나 수정 요청 흐름을 다루는 화면이다.

## Current UX Summary

- 사업 관련 값 편집을 수행한다.
- 카드와 버튼 중심의 수정 UI를 사용한다.

## Current Feature Checklist

- [x] 기본정보 수정 가능
- [x] 계약금액/부가세/기간 등 재무정보 수정 가능
- [x] 정산유형/정산기준/통장유형/자금 입력방식 변경 가능
- [x] settlement policy 필드 수정 가능
- [x] 팀 구성 수정 가능
- [x] BFF 저장 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-03] direct entry fund workflow과 관련 수정 흐름이 반영됐다.

## Known Notes

- admin wizard와 달리 자기 사업 범위 편집에 가깝다.

## Related Files

- `src/app/components/portal/PortalProjectEdit.tsx`

## Related Tests

- 현재 포털 사업 수정 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업 설정/수정 요청 흐름과 함께 본다.

## Next Watch Points

- 포털 자기 사업 수정 권한이 계속 의도대로 제한되는지
