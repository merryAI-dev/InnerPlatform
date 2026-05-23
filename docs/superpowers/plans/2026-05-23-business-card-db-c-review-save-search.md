---
id: business-card-db-c-review-save-search
status: planned
depends_on:
  - business-card-db-a-pwa-shell
  - business-card-db-b-bff-storage-gemini
unblocks:
  - business-card-db-d-security-qa-release
owners:
  - fullstack
last_reviewed_by:
  - gstack-plan-design-review
  - gstack-plan-eng-review
  - superpowers-writing-plans
---

# Business Card DB C. Review Save Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the frontend review workflow to BFF APIs and provide org-wide contact search.

**Architecture:** The frontend uses `platform-bff-client` helpers. Review forms edit draft values locally, then confirm creates canonical contacts through BFF.

**Tech Stack:** React 18, TypeScript, existing `PlatformApiClient`, Vitest

---

## Files

- Modify: `src/app/lib/platform-bff-client.ts`
- Modify: `src/app/components/business-cards/BusinessCardLabPage.tsx`
- Create: `src/app/components/business-cards/business-card-quality.ts`
- Create/Test: `src/app/components/business-cards/business-card-quality.test.ts`
- Create/Test: `src/app/components/business-cards/BusinessCardLabPage.test.tsx` if the repo test harness supports component tests

## Steps

- [ ] **Step 1: Client types**
  - Add `BusinessCardExtractedField`, `BusinessCardImportResult`, `BusinessCardConfirmPayload`, and `ContactSearchResult`.

- [ ] **Step 2: Client functions**
  - Add `processBusinessCardViaBff`, `confirmBusinessCardImportViaBff`, `listBusinessCardImportsViaBff`, and `searchContactsViaBff`.

- [ ] **Step 3: Quality helpers**
  - Implement confidence numeric mapping.
  - Implement contact save condition.
  - Implement client-side low-confidence indicator rule.

- [ ] **Step 4: Upload/process UI**
  - Convert selected image to base64.
  - Call `processBusinessCardViaBff`.
  - Render extracted draft fields.

- [ ] **Step 5: Review/confirm UI**
  - Editable fields: name, organization, department, title, role, emails, phones, website, address, memo.
  - Disable save until `(name OR organization) AND (email OR phone)` is true.
  - On save, call `confirmBusinessCardImportViaBff`.

- [ ] **Step 6: Search UI**
  - Search by name, organization, email, phone.
  - Render score only in debug/dev text or keep score hidden but preserve deterministic sorting.
  - Include image view action only when user explicitly opens detail.

- [ ] **Step 7: Verification**
  - Run focused tests for quality helpers.
  - Run `npm run build`.

## Acceptance

- User cannot save an empty or uncontactable contact.
- Low-confidence fields are visible, not silently accepted.
- Search works after confirm without page reload.
- Frontend never handles Gemini credentials.
