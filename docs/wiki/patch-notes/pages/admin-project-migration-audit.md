# Admin Project Migration Audit

- route: `/projects/migration-audit`
- primary users: admin, 데이터 이관 운영자
- status: active
- last updated: 2026-04-14

## Purpose

프로젝트 이관 상태를 점검하고 큐를 보며 데이터 이전 작업을 운영하는 감사/정리 화면이다.

## Current UX Summary

- 이관 대상과 상태를 큐 기반으로 본다.
- 이관 진행 상황과 예외 대상을 분리해서 다룬다.

## Current Feature Checklist

- [x] 이관 대상 큐 확인 가능
- [x] queue row 검색/필터 가능
- [x] current-only missing row 식별 가능
- [x] 기존 프로젝트 연결 가능
- [x] 새 프로젝트 즉시 생성 후 연결 가능
- [x] 등록 제안 수정 가능
- [x] 폐기 후 상태 반영 가능
- [x] 프로젝트 이관 운영 화면으로 사용 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.
- [2026-04-07] current-only missing row 기준이 반영됐다.
- [2026-04-06] resolve workspace와 migration audit UX가 정리됐다.

## Known Notes

- 일반 운영자보다 이관 작업 시기에만 자주 보는 화면이다.

## Related Files

- `src/app/components/projects/ProjectMigrationAuditPage.tsx`
- `src/app/components/projects/migration-audit/MigrationAuditQueueRail.tsx`

## Related Tests

- 현재 이관 감사 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업 이관 메뉴 복구 요청이 있었던 만큼 라우트 가시성과 메뉴 노출이 중요하다.

## Next Watch Points

- 이관 메뉴가 다시 사라지거나 권한에서 누락되지 않는지
