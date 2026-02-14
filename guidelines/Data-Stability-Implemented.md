# Data Stability Implemented (This Iteration)

## Implemented P0 Controls

1. Optimistic concurrency control
- Versioned writes for `projects`, `ledgers`, `transactions` in BFF.
- Updates require `expectedVersion` and reject stale writes (`409 version_conflict`).

2. Schema contracts at write boundary
- Zod request validation added for all BFF mutating endpoints.
- Invalid payloads fail fast with explicit 400 validation errors.

3. Idempotency retention cleanup
- Cleanup utility added for expired `idempotency_keys`:
  - `server/bff/idempotency-cleanup.mjs`
  - `npm run bff:cleanup:idempotency`

4. Audit append-only hardening
- BFF audit writes use `create()` (immutable insert) rather than merge-upsert.
- Audit entries include actor/request/metadata for traceability.

5. Deterministic transaction state policy
- Explicit transition policy enforced server-side:
  - `DRAFT -> SUBMITTED`
  - `SUBMITTED -> APPROVED|REJECTED`
  - `REJECTED -> SUBMITTED`
- Invalid transitions and missing rejection reason are rejected.

## Added Hardening Tracks (This Iteration)

1. Firestore composite index coverage + deploy automation
- Added explicit composite indexes including `transactions(projectId, ledgerId)`.
- Added deploy helper: `npm run firebase:deploy:indexes`.

2. Audit log hash chain and tamper verification
- Audit writes now include `chainSeq`, `prevHash`, `hash` (append-only).
- Verification endpoint: `GET /api/v1/audit-logs/verify` returns 409 on chain mismatch.

3. Outbox pattern + retry worker
- Mutating BFF routes enqueue outbox events atomically with writes.
- Added worker: `npm run bff:outbox:worker` with retry/backoff and `DEAD` status.

4. Backup/recovery rehearsal scripts
- Managed backup schedule setup: `npm run firestore:backup:schedule`.
- Restore drill workflow: `npm run firestore:backup:rehearsal`.

5. SLO/error-budget alerts
- Added structured request logging for status/latency/error code.
- Added alert setup script: `npm run monitoring:setup:alerts` (5xx ratio, p95 latency, conflict ratio).

6. Concurrency stress tests
- Added emulator integration test for 25-way concurrent state transition race; validates single-winner behavior.

7. PII encryption + key rotation hooks
- Added pluggable PII protection (`local` AES-GCM or Cloud KMS).
- Added rotation script: `npm run pii:rotate`.

8. Permission-change audit + policy-as-code
- Added role-change endpoint with policy enforcement and audit trail.
- Added policy file + verifier and CI check: `policies/rbac-policy.json`, `npm run policy:verify`.
