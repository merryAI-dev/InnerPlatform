---
id: business-card-db-d-security-qa-release
status: planned
depends_on:
  - business-card-db-c-review-save-search
unblocks:
  - business-card-db-live-verification
owners:
  - fullstack
last_reviewed_by:
  - gstack-plan-eng-review
  - gstack-plan-design-review
  - superpowers-verification-before-completion
---

# Business Card DB D. Security QA Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add security/audit checks, verify privacy boundaries, and prepare the feature for live deployment.

**Architecture:** Security is enforced server-side through RBAC, tenant-scoped reads, private Storage, and audit logs. Frontend visibility is only convenience, not authorization.

**Tech Stack:** Express BFF, Firebase Admin, RBAC policy, Vitest, Vercel deploy workflow

---

## Files

- Modify: `policies/rbac-policy.json`
- Modify: `server/bff/routes/business-cards.mjs`
- Modify/Test: `server/bff/app.integration.test.ts`
- Modify: `.env.example`
- Update: `docs/wiki/business-card-db/log.md`

## Steps

- [ ] **Step 1: RBAC policy**
  - Add `contact:read`, `contact:write`, `contact:image:read`, and `contact:delete`.
  - Allow org-wide read for authenticated internal roles.
  - Restrict delete to admin/tenant_admin/security.

- [ ] **Step 2: Audit events**
  - Write audit events for process, gemini failure, confirm, image view, search, create, update.
  - Hash search query before writing audit metadata.

- [ ] **Step 3: Image privacy**
  - Ensure Storage upload does not set `firebaseStorageDownloadTokens`.
  - Ensure API responses do not include public image URL.
  - Ensure image endpoint streams only after auth and tenant validation.

- [ ] **Step 4: Privacy tests**
  - Unauthenticated image request returns 401/403.
  - Cross-tenant image request returns 403/404.
  - Search audit does not contain raw query.

- [ ] **Step 5: Release tests**
  - Run `npm run build`.
  - Run `npx vitest run src/app/platform/shell-lab-visibility.test.ts`.
  - Run `npx vitest run server/bff/app.integration.test.ts`.

- [ ] **Step 6: Manual QA**
  - iPhone Safari capture.
  - Android Chrome capture.
  - Desktop upload.
  - Confirm and search.
  - Direct image endpoint without auth fails.

- [ ] **Step 7: Deploy**
  - Use existing Vercel deploy flow.
  - Verify aliases:
    - `https://submit-mysc.com`
    - `https://inner-platform.vercel.app`
    - `https://inner-platform-merryai-devs-projects.vercel.app`

## Acceptance

- No public image URLs appear in API payloads or Firestore docs.
- Image access is audited.
- Search raw query is not stored in audit logs.
- Live alias points to deployment verified after smoke test.
