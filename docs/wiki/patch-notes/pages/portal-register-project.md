# Portal Register Project

- route: `/portal/register-project`
- primary users: PM, 사업 등록 제안 담당자
- status: active
- last updated: 2026-04-14

## Purpose

신규 사업 등록 제안을 올리고 계약/재무/팀 구성 정보를 입력하는 포털 등록 화면이다.

## Current UX Summary

- 단계형 등록 플로우에서 초안 저장과 단계 게이팅을 함께 다룬다.
- 계약서 PDF가 없는 예외 시나리오와 직접 입력형 자금 흐름 등록이 핵심 분기다.
- 등록 완료 이후 운영 알림과 후속 검토 흐름이 이어진다.

## Current Feature Checklist

- [x] 단계형 사업 등록 제안 가능
- [x] 초안 자동저장 가능
- [x] 직접 입력형 자금 흐름(`DIRECT_ENTRY`) 등록 가능
- [x] 계약서 PDF 예외 처리 가능
- [x] 등록 완료 후 운영 알림 연계
- [x] 팀 구성과 계약 금액 입력 가능

## Recent Changes

- [2026-04-03] 직접 입력형 자금 흐름(`DIRECT_ENTRY`) 등록 플로우를 추가했다.
- [2026-04-03] 등록 완료 후 BFF/Slack 알림 연계를 넣었다.
- [2026-04-03] 투자사업 등록 정책과 등록값 정합성을 정리했다.
- [2026-04-01] draft 자동저장과 단계 게이팅 완화를 반영했다.
- [2026-03-27] viewer 등록 허용과 PDF 선택 입력 UX를 강화했다.

## Known Notes

- 계약서 PDF 필수/선택 정책은 운영 정책 변경의 영향을 직접 받는다.
- 직접 입력형 자금 흐름과 일반 사업 등록 흐름은 후속 정산 구조에도 영향을 준다.

## Related Files

- `src/app/components/portal/PortalProjectRegister.tsx`
- `src/app/platform/project-request-registration.ts`
- `src/app/routes.tsx`

## Related Tests

- `src/app/components/portal/project-proposal.test.ts`
- `src/app/platform/project-request-registration.test.ts`
- `src/app/platform/project-team-members.test.ts`
- `src/app/platform/project-contract-amount.test.ts`

## Related QA / Ops Context

- 등록 제안, 계약서 업로드, 투자사업/펀드형 사업 예외 정책은 QA memory의 `project_register`, `contract_upload`, `project_settings`와 이어진다.

## Next Watch Points

- 계약서 선택 입력 예외가 다시 막히지 않는지
- draft autosave와 단계 게이팅이 서로 충돌하지 않는지
- 직접 입력형 자금 흐름이 후속 portal/admin 정산 화면과 계속 정합한지
