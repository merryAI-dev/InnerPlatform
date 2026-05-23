---
id: business-card-db-a-pwa-shell
status: planned
depends_on:
  - business-card-db-umbrella
unblocks:
  - business-card-db-c-review-save-search
owners:
  - frontend
last_reviewed_by:
  - gstack-plan-design-review
  - superpowers-writing-plans
---

# Business Card DB A. PWA Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the LAB-gated PWA route shell and mobile image capture scaffold for the business card DB.

**Architecture:** The route shell is frontend-only and does not call Gemini directly. It exposes stable UI states that later connect to BFF functions.

**Tech Stack:** Vite React 18, TypeScript, React Router, existing LAB visibility helpers, Vitest

---

## Files

- Modify: `src/app/platform/shell-lab-visibility.ts`
- Modify: `src/app/platform/shell-lab-visibility.test.ts`
- Modify: `src/app/routes.tsx`
- Create: `src/app/components/business-cards/BusinessCardLabPage.tsx`
- Create: `src/app/components/business-cards/business-card-image.ts`
- Modify: `index.html`
- Create: `public/manifest.webmanifest`
- Create: `public/sw.js`

## Steps

- [ ] **Step 1: LAB visibility test**
  - Add assertions that `/business-cards` and `/portal/business-cards` are hidden when LAB is off and visible when LAB is on.

- [ ] **Step 2: LAB visibility implementation**
  - Add `/business-cards` to `ADMIN_LAB_ROUTES`.
  - Add `/portal/business-cards` to `PORTAL_LAB_ROUTES`.

- [ ] **Step 3: Route scaffold**
  - Add lazy import for `BusinessCardLabPage`.
  - Mount it at admin `/business-cards` and portal `/portal/business-cards`.

- [ ] **Step 4: Mobile capture helper**
  - Create `business-card-image.ts` with image MIME validation, base64 conversion, and compression target constants.
  - Use client target `3MB`, max dimension `1800px`, initial JPEG quality `0.82`.

- [ ] **Step 5: Page scaffold**
  - Create tabs: `검색`, `명함 등록`, `검토 대기`.
  - In `명함 등록`, use `<input type="file" accept="image/*" capture="environment">`.
  - Show preview, file name, size, and disabled submit placeholder until BFF client exists.

- [ ] **Step 6: PWA metadata**
  - Add `manifest.webmanifest` with MYSCube naming and brand colors.
  - Add service worker that caches shell assets only.
  - Add manifest/meta tags and service worker registration in `index.html` or app bootstrap.

- [ ] **Step 7: Verification**
  - Run `npx vitest run src/app/platform/shell-lab-visibility.test.ts`.
  - Run `npm run build`.

## Acceptance

- LAB off hides both business-card routes from shell surfaces.
- Route loads without runtime crash.
- Mobile upload control is visible and does not depend on server code.
- No image/API response is cached by service worker.
