# Firestore Query Read Model Inventory

날짜: 2026-06-30
상태: Draft
상위 계획: `docs/architecture/sql-read-model-query-api-ai-plan-2026-06-30.md`

## 범위

`SQL read model + Query API` 1차 구현 전에 필요한 Firestore collection 이름을 현재 코드 기준으로 정리한다.
이 문서는 DB 설계서가 아니라 drift 방지용 인벤토리다.

## Query API MVP 필수 컬렉션

| Collection | 근거 | 현재 상태 |
| --- | --- | --- |
| `projects` | `src/app/lib/firebase.ts`, `server/bff/routes/projects.mjs`, `server/bff/projections.mjs` | schema catalog 반영됨 |
| `transactions` | `src/app/lib/firebase.ts`, `server/bff/routes/transactions.mjs`, `server/bff/projections.mjs` | schema catalog 반영됨 |
| `cashflow_weeks` | `src/app/lib/firebase.ts`, `server/bff/cashflow-canonical-store.mjs`, `server/bff/routes/cashflow-exports.mjs`, `server/bff/routes/cashflow-sheet-lab.mjs` | schema catalog 반영됨 |
| `members` | `src/app/lib/firebase.ts`, `server/bff/routes/members.mjs`, `server/bff/projections.mjs` | schema catalog 반영됨 |
| `views` | `server/bff/projections.mjs`, `server/bff/app.mjs` | Firestore read view. SQL read model 전환 전 기준 |

## Cashflow 주변 컬렉션

| Collection | 용도 | 근거 |
| --- | --- | --- |
| `cashflow_events` | cashflow 변경 이벤트 | `src/app/lib/firebase.ts`, `server/bff/routes/cashflow-sheet-lab.mjs` |
| `cashflow_change_candidates` | 시트 반영 후보/staging | `src/app/lib/firebase.ts`, `server/bff/routes/cashflow-sheet-lab.mjs` |
| `cashflow_actual_sync_state` | Actual sync 상태 | `server/bff/cashflow-canonical-store.mjs` |
| `weekly_submission_status` | 주차별 제출 상태 | `src/app/lib/firebase.ts`, `server/bff/cashflow-canonical-store.mjs` |

## 운영/백엔드 컬렉션

| Collection | 용도 | 근거 |
| --- | --- | --- |
| `work_queue` | view rebuild/replay worker queue | `server/bff/work-queue.mjs` |
| `change_events` | 변경 이벤트 | `server/bff/app.mjs` |
| `outbox` | outbox worker | `server/bff/outbox.mjs` |
| `idempotency_keys` | mutating route idempotency | `server/bff/idempotency.mjs` |
| `audit_logs` | 감사 로그 | `server/bff/audit-chain.mjs`, `server/bff/routes/audit.mjs` |
| `audit_chain` | 감사 체인 검증 | `server/bff/audit-chain.mjs` |

## 확인 필요 Drift

| 항목 | 현재 관찰 | 조치 |
| --- | --- | --- |
| `partEntries` vs `part_entries` | 프론트 `ORG_COLLECTIONS.partEntries`는 `part_entries`인데, `server/bff/routes/projects.mjs`는 `orgs/${tenantId}/partEntries`를 직접 사용한다. ETL도 `participationEntries` staging 이름을 사용한다. | Query API MVP에는 포함하지 않는다. 별도 participation read model slice에서 정리한다. |
| camelCase collection | `projectRequestDrafts`, `careerProfiles`, `trainingCourses`, `trainingEnrollments`는 Firestore wire 이름도 camelCase다. | 새 Query API collection은 snake_case를 기본으로 둔다. 기존 이름은 마이그레이션 전까지 유지한다. |

## 검증 명령

```bash
npm run etl:verify:query-readmodel-schema
```

현재 검증 범위:

- `projects`
- `transactions`
- `cashflow_weeks`
- `members`
- stale `cashflowWeekSheets` 금지
