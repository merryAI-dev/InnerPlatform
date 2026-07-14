# Portal Onboarding

- route: `/login`, `/`, `/workspace-select`
- primary users: 전체 사용자
- status: active
- last updated: 2026-07-14

## Purpose

로그인과 전환 화면을 거쳐 기능 검색 엔트리로 진입시키고, 필요 시 관리자 공간 또는 실무자 포털로 이동시키는 시작 화면 묶음이다.

## Current UX Summary

- 로그인 화면은 계정 인증과 예외 상태만 보여준다.
- 로그인 성공 직후에는 빈 화면 대신 짧은 glassmorphism 전환 화면을 보여준 뒤 기능 검색 엔트리로 이동한다.
- 기능 검색 엔트리는 관리자/실무자 주요 기능을 색상으로 구분하되, 실제 업무 화면 진입 후에는 사이드바/단축키에서 `기능 검색` 항목을 숨긴다.
- 공간 선택 화면은 로그인 직후 관리자와 실무자 포털의 주요 진입점을 glassmorphism panel과 색상으로 구분해 보여주고 바로 진입시킨다.
- 별도 Guided Start 카드 없이 핵심 선택만 남긴다.

## Current Feature Checklist

- [x] 로그인 가능
- [x] 로그인 성공 후 기능 검색 엔트리로 부드럽게 이동 가능
- [x] 역할별 기본 진입 경로 판단 가능
- [x] workspace 선택 가능 계정은 공간 선택 후 진입 가능
- [x] 관리자 빠른 진입 버튼에 hover/focus 메모형 설명 제공
- [x] `프로젝트 등록` 검색은 실제 프로젝트 레코드가 아니라 등록 관련 기능만 우선 노출
- [x] workspace 선택 화면에서 관리자/실무자 주요 기능이 색상과 기능 chip으로 구분됨
- [x] 포털 미등록 사용자는 온보딩 선택 카드에서 기존 사업 선택, 증빙 업로드, 새 사업 등록으로 실제 이동 가능
- [x] Guided Start 카드 없이 핵심 인증/선택 UI만 유지
- [ ] 공간 설명 카피는 더 압축할 여지 있음

## Recent Changes

- [2026-07-14] 기획안의 사용자 용어에 맞춰 workspace 선택, 기능 검색, 프로젝트 등록 안내의 `PM 포털` 표기를 `실무자 포털`로 통일했다.
- [2026-05-21] 로그인 성공 후 빈 화면 없이 짧은 전환 화면을 거쳐 `/` 기능 검색 엔트리로 이동하도록 조정했다.
- [2026-05-21] 실제 업무 화면 진입 후에는 사이드바, 커맨드 인덱스, 단축키에서 `기능 검색` 자기 참조 항목을 제거했다.
- [2026-05-21] 기능 검색 엔트리의 관리자 빠른 진입 버튼에 메모형 hover/focus 설명을 추가하고, `프로젝트` 라벨을 `전체 프로젝트 보기`로 바꿨다.
- [2026-05-21] `프로젝트 등록` 검색 시 프로젝트 레코드가 섞이지 않고 등록/승인 및 PM 등록 요청 기능만 노출되도록 검색 후보를 필터링했다.
- [2026-05-21] workspace 선택 화면을 MYSCube 브랜드 slab와 관리자/PM 색상 구분형 feature map으로 재구성해, 로그인 직후 어떤 업무 공간으로 들어가는지 더 빨리 판단하게 했다.
- [2026-05-21] workspace 선택 화면의 배경, 공간 카드, 기능 chip, CTA를 translucent surface와 blur 기반 glassmorphism 톤으로 조정했다.
- [2026-04-15] 포털 시작 선택 카드는 standalone entry path 정책을 공통 helper로 보게 정리했고, deep route 진입 후에도 fallback 선택 화면이 다시 덮이지 않도록 복구했다.
- [2026-04-15] `기존 사업 선택`은 `사업 배정 수정`이 아니라 실제 세션 사업 선택 단계인 `/portal/project-select`로 연결되게 바꿨다.
- [2026-04-15] workspace 선택 화면에서 사용자가 `관리자 공간` 또는 `PM 포털 공간`을 명시적으로 고르면, 그 공간에 맞는 redirect만 유지하도록 정리했다.
- [2026-04-14] PM 포털 진입을 바로 `/portal`로 보내지 않고 `/portal/project-select` step을 거친 뒤 세션 기준 사업을 고르게 바꿨다.
- [2026-04-15] 포털 미등록 상태에서 온보딩 선택 카드를 눌렀을 때 `register-project`와 `weekly-expenses`가 강제 리다이렉트에 다시 덮이지 않도록 bypass 경로를 `shouldForcePortalOnboarding` 정책과 맞췄다.
- [2026-04-14] 로그인 화면의 `Guided Start` 블록을 제거했다.
- [2026-04-14] workspace 선택 화면의 PM 안내 문구를 더 직접적으로 정리했다.

## Known Notes

- 이 영역은 설명보다는 인증 성공과 빠른 진입이 우선이다.
- 데모 로그인, preview auth 예외, workspace 선택은 계속 분기 복잡도가 높다.

## Related Files

- `src/app/components/auth/LoginPage.tsx`
- `src/app/components/auth/WorkspaceSelectPage.tsx`
- `src/app/components/brand/MyscWordmark.tsx`
- `src/app/platform/navigation.ts`

## Related Tests

- `src/app/platform/navigation.test.ts`
- `src/app/platform/preview-auth.test.ts`
- `src/app/data/member-workspace.test.ts`
- `src/app/components/auth/WorkspaceSelectPage.shell.test.ts`

## Related QA / Ops Context

- 최근 운영 방향에서 시작 화면의 튜토리얼성 카드를 줄이고 바로 작업 공간으로 들어가게 하는 쪽을 우선했다.

## Next Watch Points

- preview auth / dev harness 분기에서 진입 CTA가 여전히 명확한지
- workspace 선택 화면 카피가 다시 과도하게 길어지지 않는지
