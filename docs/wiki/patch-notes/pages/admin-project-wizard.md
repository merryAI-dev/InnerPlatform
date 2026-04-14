# Admin Project Wizard

- route: `/projects/new`, `/projects/:projectId/edit`
- primary users: admin
- status: active
- last updated: 2026-04-14

## Purpose

사업 생성 또는 기존 사업 수정에 필요한 단계형 wizard 화면이다.

## Current UX Summary

- 신규 생성과 수정이 같은 단계형 흐름을 공유한다.
- 사업 기본 정보, 재무 기준, 운영 설정 값을 단계별로 편집한다.

## Current Feature Checklist

- [x] 신규 사업 생성 가능
- [x] 기존 사업 수정 가능
- [x] 기본정보 step 입력 가능
- [x] 계약/일정 step 입력 가능
- [x] 통장/정산 step 입력 가능
- [x] 팀/담당자 step 입력 가능
- [x] 재무/입금계획 step 입력 가능
- [x] review 후 저장/확정 가능

## Recent Changes

- [2026-04-14] 전체 페이지 문서화 backfill 기준으로 현재 구현 체크리스트를 정리했다.

## Known Notes

- `/projects/new`는 별도 redirect를 거치지만 실질 작업면은 이 wizard다.

## Related Files

- `src/app/components/projects/ProjectWizardPage.tsx`
- `src/app/components/projects/ProjectRegisterRedirectPage.tsx`

## Related Tests

- 현재 wizard 화면 전용 패치노트 seed 테스트는 없다.

## Related QA / Ops Context

- 사업 등록/수정 정책과 입력 필수값 변경은 wizard 해석에 바로 영향을 준다.

## Next Watch Points

- 신규 생성과 수정 모드의 필드/저장 동작이 계속 일치하는지
