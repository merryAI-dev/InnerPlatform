# Shared Label Policy

- route: `shared / policy`
- primary users: 운영자, QA, 개발자
- status: active
- last updated: 2026-04-15

## Purpose

화면 라벨, 내부 enum, 엑셀/시트 라벨, 서버 export 라벨 사이의 관계를 한 곳에서 관리하는 공용 정책 문서다.

## Current UX Summary

- 사용자는 canonical 라벨만 본다.
- 시스템은 enum과 sheet line id를 저장/처리에 사용한다.
- 입력 alias는 parse 단계에서만 허용하고, 다시 표시하거나 export할 때는 canonical 라벨로 정규화한다.

## Current Feature Checklist

- [x] `cashflow` category label 기준이 JSON source of truth로 통합됨
- [x] `cashflow` sheet line label 기준이 같은 source of truth를 사용함
- [x] alias parsing 규칙이 정책 레이어 한 곳으로 이동함
- [x] bank import와 settlement csv가 같은 policy API를 사용함
- [x] BFF cashflow export가 같은 정책 데이터를 기준으로 라벨을 출력함
- [ ] 다른 enum 도메인까지 같은 정책 구조로 확장됨

## Recent Changes

- [2026-04-15] `cashflow` label <-> enum <-> sheet line id <-> export label 기준을 JSON source of truth로 통합했다.
- [2026-04-15] `bank-import-cashflow`, `settlement-csv`, `types`, `server/bff/cashflow-export`가 policy 데이터를 공유하도록 정리했다.
- [2026-04-15] alias는 입력 호환용으로만 유지하고 canonical 라벨 재출력을 기본 원칙으로 문서화했다.

## Known Notes

- 현재 1차 적용 범위는 `cashflow`다.
- `직접사업비`는 sheet line label이고, `OUTSOURCING`은 내부 category enum이다. 둘은 같은 문자열이 아니라 정책적으로 연결된 다른 층위다.
- 향후 다른 enum도 같은 구조로 이관하되, 직접 문자열 비교는 새 코드에서 금지한다.

## Related Files

- `src/app/policies/cashflow-policy.json`
- `src/app/platform/policies/cashflow-policy.ts`
- `src/app/platform/bank-import-cashflow.ts`
- `src/app/platform/settlement-csv.ts`
- `src/app/data/types.ts`
- `server/bff/cashflow-policy.mjs`
- `server/bff/cashflow-export.mjs`

## Related Tests

- `src/app/platform/policies/cashflow-policy.test.ts`
- `src/app/platform/bank-import-cashflow.test.ts`
- `src/app/platform/settlement-csv.test.ts`
- `src/app/platform/bank-statement.test.ts`
- `src/app/data/portal-store.persistence.test.ts`
- `server/bff/cashflow-export.test.mjs`

## Related QA / Ops Context

- QA에서 `cashflow항목`은 화면에 보이는 값과 내부 처리값이 달라 이해하기 어렵다는 피드백이 있었다.
- 운영/QA와 개발이 같은 항목을 다른 언어로 부르지 않도록 정책 문서를 source of truth 근거와 함께 유지해야 한다.

## Next Watch Points

- 새 cashflow 항목 추가 시 JSON source of truth와 policy test가 같이 갱신되는지
- export canonical 라벨과 화면 canonical 라벨이 다시 분기하지 않는지
- 다른 enum 도메인도 같은 구조로 흡수할지 우선순위를 정할지
