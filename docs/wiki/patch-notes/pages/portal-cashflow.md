# Portal Cashflow

- route: `/portal/cashflow`
- primary users: PM
- status: active
- last updated: 2026-04-14

## Purpose

포털 사용자가 자기 사업의 캐시플로 관련 상태를 보고, 필요한 경우 외부 시트 기반 작업으로 이어가는 화면이다.

## Current UX Summary

- 캐시플로 관련 정보를 본다.
- Google Sheet import 같은 보조 액션을 사용한다.

## Current Feature Checklist

- [x] 미배정 사업 guard 반영
- [x] Google Sheets/`xlsx`/`csv` 가져오기 진입 가능
- [x] compare mode/guide preview 노출 가능
- [x] projection 시트 편집/저장 가능
- [x] migration wizard 적용 후 시트 반영 가능
- [x] PM 관점의 캐시플로 확인면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-04] compare mode, guide preview, migration entrypoint가 정리됐다.

## Known Notes

- admin cashflow export와는 별개로 PM 관점 확인 면이다.

## Related Files

- `src/app/components/portal/PortalCashflowPage.tsx`

## Related Tests

- 현재 포털 캐시플로 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 주간 actual 반영과 projection 비교 흐름과 문맥이 이어진다.

## Next Watch Points

- 외부 시트 import 보조 동작이 계속 유효한지
