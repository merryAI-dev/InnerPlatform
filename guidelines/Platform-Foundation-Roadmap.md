# Platform Foundation Roadmap (Implemented + Next)

## Implemented in This Repository

### 1) Tenant Isolation Baseline
- Added tenant validation/path helpers in `src/app/platform/tenant.ts`.
- `getDefaultOrgId()` now validates tenant IDs with strict mode (`VITE_TENANT_ISOLATION_STRICT=true`).
- Firestore writes now stamp `tenantId` on records via `withTenantScope()`.

### 2) Standard Request Metadata
- Added request metadata helpers in `src/app/platform/request-context.ts`.
- Standardized headers for API-style traffic:
  - `x-request-id`
  - `x-tenant-id`
  - `x-actor-id`
  - `idempotency-key` (mutation methods only)

### 3) RBAC/Claims Processing
- Added claim parser + permission checks in `src/app/platform/rbac.ts`.
- Firebase auth sync now reads token claims and resolves tenant context.

### 4) Audit Normalization
- Added canonical audit schema in `src/app/platform/audit-log.ts`.
- Firestore service writes now generate richer audit entries (`tenantId`, `requestId`, actor metadata).

### 5) Firestore Security Rules Hardening
- `firebase/firestore.rules` now enforces tenant consistency for create/update and validates tenant-scoped reads.
- `audit_logs` create now validates `userId == request.auth.uid`.

## Next Execution Blocks (Recommended Order)

1. API Gateway Layer
- Introduce `/api/v1/*` BFF (Cloud Run) and route all mutations through server-side policy checks.

2. Idempotency Store
- Persist idempotency keys (Firestore/Redis) to guarantee exactly-once behavior for POST/PATCH.

3. Operational SLOs
- Add request telemetry (OpenTelemetry), error budget alerts, and rollout guardrails.

4. Tenant Ops UX
- Add admin tenant switcher, tenant-level feature flags, and policy simulation UI.
