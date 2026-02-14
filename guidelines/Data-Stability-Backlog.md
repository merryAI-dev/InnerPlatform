# Data Stability Backlog (Next 10)

## P0 (Immediate)

1. Transaction-level optimistic concurrency
- Add `version` field to mutable docs and enforce compare-and-set updates in BFF.
- Prevents lost updates from concurrent operators.

2. Schema contracts at write boundary
- Enforce Zod schema validation in every BFF mutation route.
- Reject malformed payloads before Firestore write.

3. Idempotency retention + cleanup job
- Add TTL policy and scheduled cleanup for `idempotency_keys`.
- Avoid unbounded growth and stale key collisions.

4. Audit log immutability hardening
- Split `audit_logs` into append-only partition and forbid merge updates after create.
- Guarantees forensic integrity.

5. Deterministic state-transition policy
- Centralize allowed transitions (`DRAFT -> SUBMITTED -> APPROVED|REJECTED`) in server policy map.
- Blocks invalid process jumps.

## P1 (Near-term)

6. Outbox pattern for side effects
- Persist write + outbox event atomically, then async dispatch notifications/webhooks.
- Prevents write-success / event-fail inconsistency.

7. Data reconciliation worker
- Scheduled job compares transaction totals, evidence linkage, and orphan refs.
- Produces repair report and auto-fix candidates.

8. Per-tenant rate limits + quotas
- Limit burst mutation volume by tenant and actor.
- Reduces accidental bulk corruption and abuse.

## P2 (Scale hardening)

9. Backup + restore drill automation
- Daily export + monthly restore rehearsal in isolated project.
- Validates RPO/RTO in practice, not just policy.

10. Cross-region recovery posture
- Document and test Firestore export replication + cold-standby bootstrap.
- Lowers regional outage blast radius.
