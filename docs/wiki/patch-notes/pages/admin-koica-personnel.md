# Admin Koica Personnel

- route: `/koica-personnel`
- primary users: admin, KOICA 인력 관리 담당자
- status: active
- last updated: 2026-04-14

## Purpose

KOICA 전용 인력 데이터를 관리하고 상태/문서를 검토하는 관리자 화면이다.

## Current UX Summary

- 카드와 탭 기반으로 KOICA 인력 현황을 본다.
- 프로젝트 특화 인력 관리 흐름을 다룬다.

## Current Feature Checklist

- [x] project/person 탭 전환 가능
- [x] 이름/사업 검색 가능
- [x] 등급별 소계 확인 가능
- [x] 현행/변경 인력 비교 가능
- [x] 실급여 입력 가능
- [x] 비용 차이 KPI 확인 가능
- [x] 관리자 전용 인력 운영 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- 일반 participation과 달리 KOICA 전용 구조를 가진다.

## Related Files

- `src/app/components/koica/KoicaPersonnelPage.tsx`

## Related Tests

- 현재 KOICA 인력 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- KOICA 전용 인력 운영 요구가 있을 때 함께 참고하는 문서다.

## Next Watch Points

- KOICA 전용 항목과 일반 인력 관리 정책이 섞이지 않는지
