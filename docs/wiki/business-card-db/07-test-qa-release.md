---
id: business-card-db-test-qa-release
status: planned
depends_on:
  - business-card-db-pwa-mobile-capture
  - business-card-db-security-privacy-rbac
  - business-card-db-search-dedupe-quality
unblocks: []
---

# 07 Test QA Release

## Unit Tests

- Gemini output normalizer handles valid structured JSON.
- Gemini output normalizer falls back on malformed JSON.
- Confidence formula returns expected numeric thresholds.
- Search token generation supports Korean, English, email, phone.
- Duplicate score classifies strong/review/hidden candidates.
- LAB visibility hides `/business-cards` and `/portal/business-cards` by default.

## BFF Integration Tests

- `POST /api/v1/business-card-imports/process` uploads private image and creates import draft.
- Gemini mock failure creates safe error response and does not create contact.
- `POST /api/v1/business-card-imports/:importId/confirm` creates contact and marks import `saved`.
- `GET /api/v1/contacts?query=` returns ranked org-visible results.
- `GET /api/v1/business-card-imports/:importId/image` rejects unauthenticated requests.
- Image endpoint rejects cross-tenant access.

## Frontend Tests

- Upload form accepts image files and blocks unsupported file types.
- Low-confidence fields render with warning state.
- Save is disabled until `(name OR organization) AND (email OR phone)` is true.
- Saved contact appears in search result list.
- LAB off removes nav/command entry points.

## Manual QA

- iPhone Safari: camera capture and gallery upload.
- Android Chrome: camera capture and gallery upload.
- Desktop Chrome: file upload, review, save, search.
- PWA install: home-screen launch reaches expected start URL.
- Image privacy: copied image endpoint fails without auth.
- Vercel: production alias points to the intended deployment.

## Release Checklist

```text
npm run build
npx vitest run src/app/platform/shell-lab-visibility.test.ts
npx vitest run server/bff/app.integration.test.ts
```

## Release Evidence

Before reporting the release as complete, capture:

- Vercel deployment URL
- canonical alias URL
- `npm run pwa:verify:live -- https://inner-platform.vercel.app` output
- iPhone model, iOS version, Safari result
- Android model, Android version, Chrome result
- Firebase Auth authorized domain screenshot or operator confirmation
- Firestore/Storage rules deploy command and timestamp

### Pre-Deploy Evidence - 2026-05-23 13:29 KST

- Local PWA package: `npm run pwa:qa` passed.
- Local full test suite: `npm test` passed, 1298 passed and 52 skipped.
- Whitespace check: `git diff --check` passed.
- Firebase dry run: `npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project inner-platform-live-20260316 --dry-run` passed; Firestore and Storage rules compiled successfully.
- Firebase Auth authorized domains: Identity Toolkit API confirmed `inner-platform.vercel.app`.
- Vercel project link: `merryai-devs-projects/inner-platform`.
- Current production deployment before this release: `inner-platform-gxizhdk2u-merryai-devs-projects.vercel.app`.
- Current production aliases before this release: `submit-mysc.com`, `inner-platform.vercel.app`, `inner-platform-merryai-devs-projects.vercel.app`.
- Production env names present: `VITE_PLATFORM_API_ENABLED`, `VITE_PLATFORM_API_BASE_URL`, Firebase web config, `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Gemini runtime: manual-review fallback mode, Vertex env pending. Production env list does not currently include `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, or `BUSINESS_CARD_GEMINI_MODEL`.
- Pre-deploy live PWA gate: failed as expected because current production still serves manifest/icons/service worker as HTML fallback and still returns `Permissions-Policy: camera=()`.
- Firebase production rules/index deploy: `npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project inner-platform-live-20260316` completed at 2026-05-23 13:31 KST.
- Firestore index note: removed unnecessary composite indexes for `business_card_imports(status, __name__)` and `contacts(searchTokens, __name__)`; Firestore rejected them as single-field-index cases.

Manual smoke:

- LAB on/off behavior
- mobile upload
- Gemini extraction
- manual review save
- search
- image access
- audit events

## Acceptance

- No deploy unless build and focused tests pass.
- No deploy unless image access privacy is manually checked.
- Live alias must be verified after production deployment.
