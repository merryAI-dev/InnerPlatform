---
id: business-card-db-api-contract
status: planned
depends_on:
  - business-card-db-data-model
unblocks:
  - business-card-db-vertex-gemini-extraction
  - business-card-db-pwa-mobile-capture
  - business-card-db-security-privacy-rbac
---

# 02 API Contract

All endpoints are mounted under the existing BFF and require authenticated actor context.

## POST `/api/v1/business-card-imports/process`

Uploads one business card image, stores it privately, runs Vertex AI Gemini extraction, and creates a review draft.

Request:

```json
{
  "fileName": "card.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2481021,
  "contentBase64": "..."
}
```

Response:

```json
{
  "importId": "bcimp_abc123",
  "status": "needs_review",
  "storagePath": "orgs/mysc/business-cards/u1/bcimp_abc123-card.jpg",
  "extracted": {
    "name": { "value": "홍길동", "confidence": "high", "evidence": "홍길동" },
    "organization": { "value": "MYSC", "confidence": "medium", "evidence": "MYSC" },
    "department": { "value": "", "confidence": "low", "evidence": "" },
    "title": { "value": "파트너", "confidence": "medium", "evidence": "Partner" },
    "role": { "value": "", "confidence": "low", "evidence": "" },
    "emails": [{ "value": "hello@example.com", "confidence": "high", "evidence": "hello@example.com" }],
    "phones": [{ "value": "01012345678", "confidence": "high", "evidence": "010-1234-5678" }],
    "website": { "value": "", "confidence": "low", "evidence": "" },
    "address": { "value": "", "confidence": "low", "evidence": "" },
    "memo": { "value": "", "confidence": "low", "evidence": "" }
  }
}
```

Error behavior:

- `400 unsupported_mime_type`: jpeg/png/webp 외 입력
- `413 image_too_large`: server hard limit 초과
- `502 gemini_extract_failed`: Gemini call failed, import can still be stored as `failed`

## GET `/api/v1/business-card-imports?status=needs_review`

Lists review drafts for the current tenant.

Response:

```json
{
  "items": [
    {
      "id": "bcimp_abc123",
      "status": "needs_review",
      "fileName": "card.jpg",
      "uploadedByEmail": "pm@mysc.co.kr",
      "createdAt": "2026-05-23T00:00:00.000Z",
      "extracted": {}
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

## POST `/api/v1/business-card-imports/:importId/confirm`

Confirms reviewed fields and creates a canonical contact.

Request:

```json
{
  "name": "홍길동",
  "organization": "MYSC",
  "department": "파트너십팀",
  "title": "대표",
  "role": "사업 담당",
  "emails": ["hello@example.com"],
  "phones": ["01012345678"],
  "website": "https://example.com",
  "address": "서울시 ...",
  "memo": "2026년 컨퍼런스에서 받은 명함"
}
```

Response:

```json
{
  "ok": true,
  "importId": "bcimp_abc123",
  "contactId": "ct_abc123",
  "status": "saved"
}
```

## GET `/api/v1/contacts?query=...`

Org-wide contact search. An empty `query` returns the first page of org-visible contacts for DB-style browsing.

Response:

```json
{
  "items": [
    {
      "id": "ct_abc123",
      "name": "홍길동",
      "organization": "MYSC",
      "title": "대표",
      "emails": ["hello@example.com"],
      "phones": ["01012345678"],
      "score": 6.1
    }
  ],
  "count": 1,
  "nextCursor": null
}
```

## PATCH `/api/v1/contacts/:contactId`

Updates an existing org-visible contact from the business-card DB editor. The payload shape is the same as the confirm endpoint, and the BFF rebuilds normalized search keys before writing.

Response:

```json
{
  "ok": true,
  "contact": {
    "id": "ct_abc123",
    "name": "홍길동",
    "organization": "MYSC",
    "emails": ["hello@example.com"],
    "phones": ["01012345678"],
    "memo": "PC에서 수정"
  }
}
```

## GET `/api/v1/business-card-imports/:importId/image`

Streams original image after auth and audit. No Firebase public download URL is returned.

## Acceptance

- Frontend never calls Vertex AI or Firebase Storage directly for this feature.
- Every mutating endpoint writes audit metadata.
- Error responses include stable `code` values for UI copy and tests.
