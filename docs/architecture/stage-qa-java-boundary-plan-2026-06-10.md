# Stage QA Java Boundary Plan - 2026-06-10

## Decision

Stage QA keeps Firebase Auth and Firestore member/project listing as the portal entry path.
The Java weekly API is not the portal gate. Java is limited to weekly expense commands,
validation, calculation, cashflow read-model production, audit export snapshots, and write
stability concerns such as versioning and idempotency.

## Java Owns

- Weekly expense row and cell validation.
- Amount, week, budget category, and subcategory validation.
- Actual calculation.
- Projection/actual read-model generation for cashflow.
- Audit export snapshot creation.
- Weekly command persistence integrity, including version and idempotency checks.

## Java Does Not Own

- Portal entry authorization.
- Project list access.
- Budget screen Firestore read/listen paths.
- Firebase login session creation.
- Common browser telemetry such as `client-errors`.
- Stage QA project access gate.

## Stage Policy

- `VITE_PLATFORM_API_BASE_URL` still points weekly/cashflow command traffic directly to the
  Cloud Run Java API.
- Browser `client-errors` must not use `VITE_PLATFORM_API_BASE_URL`; it uses same-origin BFF
  unless `VITE_CLIENT_ERROR_API_BASE_URL` or `VITE_INTERNAL_API_BASE_URL` is explicitly set.
- Cloud Run stage defaults `JVM_WEEKLY_PROJECT_ACCESS_BACKEND=disabled` so PM QA is not blocked
  by project assignment drift.
- Live can restore strict project access with `JVM_WEEKLY_PROJECT_ACCESS_BACKEND=firestore`.
- Live database writes are forbidden during this work. Live Firestore may be inspected read-only
  to verify document shape and path compatibility.

## Read-Only DB Shape Observed

- Live data exists under `orgs/mysc` as subcollections even when `orgs/mysc` parent doc is absent.
- Member access is stored under `orgs/mysc/members/{uid}` with `role`, `status`, `projectId`,
  `projectIds`, and `portalProfile`.
- Project data is stored under `orgs/mysc/projects/{projectId}`.
- Weekly sheet data is stored under `orgs/mysc/projects/{projectId}/expense_sheets/default`.
- Bank intake lines use `orgs/mysc/projects/{projectId}/expense_intake/{lineId}` when present.
- Cashflow read model uses `orgs/mysc/cashflow_weeks/{projectId-yearMonth-weekNo}`.
- Existing budget screen data remains Firestore-owned through `budget_summary`, `budget_code_book`,
  and optional `budget_tree_v2`.

## Review Gates

- Any new weekly screen change must first state whether it violates the Java boundary above.
- Weekly screen remains input/save/navigation only.
- Projection/actual comparison UI remains `/portal/cashflow` only.
- Frontend must not add calculation, validation, forced refresh, or read-model hydration authority.
- Open code review is run before committing each stage boundary change.
- QA must check the fixed stage URL and the browser console for Java 401/403/CORS regressions.
