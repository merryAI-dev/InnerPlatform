# Global Label <-> Enum Policy

## Goal

- 화면 라벨, 내부 enum, 엑셀/시트 라벨, 서버 export 라벨 사이의 매핑을 하나의 정책 레이어로 통합한다.
- `cashflow`를 첫 적용 대상으로 삼되, 구조는 다른 enum 도메인에도 확장 가능하도록 설계한다.
- 앞으로는 UI/CSV/엑셀/BFF가 문자열을 직접 비교하지 않고 정책 모듈만 통하도록 기준을 잠근다.
- 정책과 운영 원칙을 GitHub wiki 문서에도 남겨, 기능 추가 시 같은 drift가 다시 생기지 않도록 한다.

## Problem

현재 `cashflow` 관련 매핑은 여러 레이어에 흩어져 있다.

- `src/app/data/types.ts`
  - `CashflowCategory`
  - `CASHFLOW_CATEGORY_LABELS`
- `src/app/platform/bank-import-cashflow.ts`
  - `lineId -> category`
  - `manual field -> category`
  - `manual field -> export lineId`
- `src/app/platform/settlement-csv.ts`
  - `display label -> sheet lineId`
  - `sheet lineId -> export label`
  - label alias parsing
- `src/app/data/portal-store.persistence.ts`
  - persisted manual field -> export label
- `server/bff/cashflow-export.mjs`
  - export workbook label formatting

이 구조의 문제는 세 가지다.

1. 같은 의미가 레이어마다 다른 이름으로 유지된다.
   - 예: UI에서는 `직접사업비`, 내부 로직에서는 `OUTSOURCING`, 시트 line id는 `DIRECT_COST_OUT`
2. 별칭(alias)과 export 라벨이 한 곳에서만 관리되지 않아 drift가 생기기 쉽다.
3. QA나 운영이 보는 라벨과 개발자가 보는 값이 달라 디버깅과 정책 변경이 어렵다.

## Design Principles

1. **Single Source of Truth**
   - enum, UI 라벨, 엑셀 라벨, sheet line id, alias parsing 규칙은 정책 모듈 한 곳에서 정의한다.

2. **Display and Storage Are Different, Mapping Is Explicit**
   - 표시용 라벨과 저장용 enum은 분리해도 되지만, 변환은 반드시 공용 policy API를 통해서만 한다.

3. **No Direct String Comparison**
   - 기능 코드에서 `'직접사업비'`, `'매출액(입금)'` 같은 문자열 직접 비교를 금지한다.

4. **Backward Compatibility First**
   - 기존 입력 파일과 과거 저장 데이터에서 쓰이던 alias는 유지하되, canonical label은 하나로 정한다.

5. **Policy Before Expansion**
   - 이번 작업은 `cashflow`를 우선 통합하고, 이후 다른 enum은 같은 정책 구조에 편입한다.

## Scope

### In Scope

- `cashflow` 관련 label <-> enum <-> lineId <-> export label 매핑 통합
- alias parsing 규칙 통합
- 프론트/서버 공용 정책 모듈 또는 동등한 source-of-truth 구조 도입
- 기존 사용처를 정책 모듈 경유로 교체
- 테스트 재정비
- wiki 정책 문서와 patch note 반영

### Out of Scope

- 모든 enum 도메인 일괄 이관
- 기존 Firestore 데이터 재마이그레이션
- 새로운 cashflow 항목 체계 도입
- 기존 엑셀 양식 구조 자체 변경

## Target Architecture

새 정책 레이어를 도입한다.

- 제안 경로
  - `src/app/platform/policies/cashflow-policy.ts`
  - 필요 시 서버 공유를 위해 `src/shared/policies/cashflow-policy.ts`로 승격

정책 레이어가 제공해야 하는 API:

- `getCashflowCategoryLabel(category)`
- `parseCashflowCategoryLabel(label)`
- `getCashflowSheetLineIdFromCategory(category, direction?)`
- `getCashflowCategoryFromSheetLineId(lineId, direction?)`
- `getCashflowExportLabel(lineIdOrCategory)`
- `parseCashflowAlias(raw)`
- `listCashflowPolicyEntries()`

정책 entry의 canonical shape:

```ts
type CashflowPolicyEntry = {
  category: CashflowCategory;
  canonicalLabel: string;
  sheetLineIds: CashflowSheetLineId[];
  direction?: 'IN' | 'OUT';
  exportLabels: string[];
  aliases: string[];
};
```

핵심은 `category`, `canonicalLabel`, `sheetLineIds`, `aliases`를 한 entry로 묶고, 나머지 API는 이 entry 집합에서 파생되게 만드는 것이다.

## Implementation Plan

### Phase 1. Cashflow Policy Foundation

- 기존 `CASHFLOW_CATEGORY_LABELS`, `LABEL_TO_LINE_ID`, `LINE_ID_TO_LABEL`, `CASHFLOW_LABEL_ALIASES`를 읽어 policy entry로 통합한다.
- canonical label 기준을 확정한다.
- alias는 과거 입력 호환을 위해 유지한다.

### Phase 2. Replace Frontend Consumers

- `bank-import-cashflow.ts`
- `settlement-csv.ts`
- `portal-store.persistence.ts`
- `bank-statement.ts`
- `settlement-sheet-sync.ts`
- `google-sheet-migration.ts`
- UI에서 직접 `CASHFLOW_CATEGORY_LABELS`를 읽는 surface

위 사용처를 policy API 경유로 교체한다.

### Phase 3. Replace Server Export Consumers

- `server/bff/cashflow-export.mjs`

서버 workbook export도 동일 policy 기준 라벨을 사용하게 맞춘다.

### Phase 4. Policy and Wiki

- `docs/wiki/patch-notes/pages/admin-cashflow-export.md`
- `docs/wiki/patch-notes/pages/portal-weekly-expense.md`
- `docs/wiki/patch-notes/pages/portal-bank-statement.md`
- 필요 시 `docs/wiki/patch-notes/pages/shared-label-policy.md` 신규 추가

아래 정책을 문서화한다.

- 화면 라벨은 canonical label만 노출
- enum/lineId는 저장/처리용 식별자
- 변환은 policy module만 사용
- alias는 입력 호환을 위해서만 유지

## Migration Rules

### Canonical Label

- 같은 의미에 여러 라벨이 있더라도 canonical label은 하나만 정한다.
- export와 UI는 가능하면 같은 canonical label을 우선 사용한다.
- 외부 템플릿 요구가 다를 때만 export 전용 label을 허용한다.

### Alias Handling

- alias는 parse 단계에서만 사용한다.
- 시스템이 다시 표시하거나 export할 때는 canonical label로 정규화한다.

### Unknown Values

- 인식 불가 label은 조용히 치환하지 않는다.
- parse 실패는 `undefined` 또는 명시적 fallback으로 다루고, 테스트에서 보장한다.

## Testing

### Unit

- `canonical label -> enum`
- `alias -> enum`
- `enum -> canonical label`
- `enum -> sheet line id`
- `sheet line id -> category`
- `category/lineId -> export label`
- unknown label fallback

### Integration

- bank import 후 manual field persistence
- settlement csv parse/export roundtrip
- weekly expense merge 시 사람 입력값 유지
- server-side cashflow export workbook label consistency

### Regression

- 실제 운영에서 사용한 샘플 bank statement/xls 기준 smoke verification
- 기존 QA에서 문제였던 `직접사업비` 같은 표시값이 재업로드 후 유지되는지 확인

## Risks

- canonical label을 바꾸면 기존 테스트 snapshot과 운영 기대 문자열이 많이 깨질 수 있다.
- 서버와 프론트가 policy를 따로 구현하면 다시 drift가 생긴다.
- alias 제거를 성급하게 하면 과거 엑셀 업로드 호환성이 깨질 수 있다.

## Decisions

- 이번 작업은 `cashflow`부터 시작한다.
- 하지만 구조는 `전역 label <-> enum 정책 레이어` 기준으로 설계한다.
- 향후 다른 enum 도메인도 동일 패턴으로 이관한다.
- 구현 전 순서는 `spec -> issue -> draft PR -> implementation`으로 고정한다.
