---
id: business-card-db-pwa-vertex-gemini-design
status: planned
depends_on:
  - docs/wiki/business-card-db/index.md
last_reviewed_by:
  - gstack-plan-ceo-review
  - gstack-plan-eng-review
  - gstack-plan-design-review
  - superpowers-writing-plans
---

# Business Card DB PWA + Vertex Gemini Design

## Goal

Build an InnerPlatform LAB feature where users capture or upload a business card, Vertex AI Gemini extracts contact fields, a human confirms the draft, and the confirmed contact becomes org-wide searchable.

## Architecture

The browser handles capture, preview, compression, and review UI. The BFF owns all privileged work: private Firebase Storage upload, Vertex AI Gemini calls, Firestore writes, RBAC, and audit logging. Gemini output is never canonical until confirmed by a user.

## Product Boundary

In scope:

- LAB-gated `/business-cards` and `/portal/business-cards`
- PWA metadata and mobile image capture
- Private image upload through BFF
- Vertex AI Gemini structured extraction
- Review draft and confirm flow
- Org-wide contact search
- Image view through authenticated BFF endpoint
- Audit events for upload, confirm, image view, and search

Out of scope:

- Hermes/agentic enrichment
- Native app submission
- Auto-merge
- External CRM sync
- Bulk import/export

## Data Model

Canonical collections:

```text
orgs/{tenantId}/business_card_imports/{importId}
orgs/{tenantId}/contacts/{contactId}
```

Optional future collection:

```text
orgs/{tenantId}/contact_merge_suggestions/{suggestionId}
```

Private image path:

```text
orgs/{tenantId}/business-cards/{actorId}/{importId}-{safeFileName}
```

Contact save condition:

```text
(name != "" OR organization != "")
AND
(emails.length > 0 OR phones.length > 0)
```

## Gemini Contract

Server env:

```text
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=inner-platform-live-20260316
GOOGLE_CLOUD_LOCATION=global
BUSINESS_CARD_GEMINI_MODEL=gemini-2.5-flash
```

Structured response fields:

```text
name
organization
department
title
role
emails[]
phones[]
website
address
memo
rawText
warnings[]
```

Every extracted value carries:

```json
{ "value": "string", "confidence": "high|medium|low", "evidence": "string" }
```

Confidence formula:

```text
C_field = 0.70 * C_gemini + 0.20 * C_rule + 0.10 * C_user_confirmed
```

## API Surface

```text
POST /api/v1/business-card-imports/process
GET  /api/v1/business-card-imports?status=needs_review
POST /api/v1/business-card-imports/:importId/confirm
GET  /api/v1/contacts?query=...
GET  /api/v1/business-card-imports/:importId/image
```

## UX Shape

The page has three primary tabs:

- `검색`: org-wide contact search
- `명함 등록`: capture/upload, preview, process, review
- `검토 대기`: imports not yet confirmed

The mobile flow is:

```text
촬영/업로드 -> 미리보기 -> Gemini 추출 -> 검토/수정 -> 저장 -> 검색 가능
```

## Security And Privacy

- Contact visibility is `org`.
- Original images are retained indefinitely.
- Images are private Storage objects, never public download URLs.
- Image view writes an audit event.
- Search audit stores a query hash, not raw query.

## Quality Formulas

Search ranking:

```text
S_search =
  3.0 * name_match
+ 2.5 * email_match
+ 2.0 * phone_match
+ 1.5 * organization_match
+ 1.0 * title_match
+ 0.2 * recency_boost
```

Duplicate candidate score:

```text
S_dup =
  0.45 * email_exact
+ 0.30 * phone_exact
+ 0.15 * name_similarity
+ 0.10 * organization_similarity
```

## Verification

Minimum release gate:

```bash
npm run build
npx vitest run src/app/platform/shell-lab-visibility.test.ts
npx vitest run server/bff/app.integration.test.ts
```

Manual QA must cover iPhone Safari, Android Chrome, desktop upload, search, and image privacy.
