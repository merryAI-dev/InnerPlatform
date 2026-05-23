---
id: business-card-db-b-bff-storage-gemini
status: planned
depends_on:
  - business-card-db-umbrella
unblocks:
  - business-card-db-c-review-save-search
owners:
  - backend
last_reviewed_by:
  - gstack-plan-eng-review
  - superpowers-writing-plans
---

# Business Card DB B. BFF Storage Gemini Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side private image upload, Vertex AI Gemini extraction, import draft persistence, and route tests.

**Architecture:** The BFF accepts base64 image payloads, saves private Storage objects, calls Gemini with structured output, validates the response, and writes `business_card_imports`.

**Tech Stack:** Express BFF, Firebase Admin Storage/Firestore, Zod, `@google/genai`, Vitest/supertest

---

## Files

- Modify: `package.json`
- Modify: `.env.example`
- Modify: `server/bff/schemas.mjs`
- Create: `server/bff/business-card-storage.mjs`
- Create: `server/bff/business-card-gemini-ai.mjs`
- Create: `server/bff/routes/business-cards.mjs`
- Modify: `server/bff/app.mjs`
- Modify/Test: `server/bff/app.integration.test.ts`

## Steps

- [ ] **Step 1: Add schemas**
  - Add `businessCardProcessSchema`, `businessCardConfirmSchema`, and `businessCardSearchSchema`.
  - Enforce MIME allowlist and server hard limit `8MB`.

- [ ] **Step 2: Add private Storage service**
  - Follow the existing contract storage pattern but do not create Firebase download token.
  - Return `storagePath`, `size`, `contentType`, `uploadedAt`; never return `downloadURL`.

- [ ] **Step 3: Add Gemini service**
  - Use `@google/genai` configured for Vertex AI.
  - Read env: `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `BUSINESS_CARD_GEMINI_MODEL`.
  - Send inline image data and structured response schema.
  - Normalize confidence, email, phone, website, evidence.

- [ ] **Step 4: Add route module**
  - `POST /api/v1/business-card-imports/process`
  - `GET /api/v1/business-card-imports`
  - `POST /api/v1/business-card-imports/:importId/confirm`
  - `GET /api/v1/contacts`
  - `GET /api/v1/business-card-imports/:importId/image`

- [ ] **Step 5: Mount route**
  - Add service defaults in `createBffApp`.
  - Inject route dependencies for tests.

- [ ] **Step 6: Integration tests**
  - Mock Storage service and Gemini service.
  - Verify process creates import draft.
  - Verify Gemini failure does not create contact.
  - Verify image endpoint blocks unauthenticated or cross-tenant access.

- [ ] **Step 7: Verification**
  - Run `npx vitest run server/bff/app.integration.test.ts`.

## Acceptance

- `process` creates `business_card_imports` with `needs_review` on success.
- Gemini output is validated before returning to frontend.
- Storage result contains no public URL or token.
- Tests can run without real Vertex AI credentials.
