---
id: business-card-db-data-model
status: implemented
depends_on:
  - business-card-db-product-brief
unblocks:
  - business-card-db-api-contract
  - business-card-db-search-dedupe-quality
  - business-card-db-security-privacy-rbac
---

# 01 Data Model

## Firestore Collections

```text
orgs/{tenantId}/business_card_imports/{importId}
orgs/{tenantId}/contacts/{contactId}
orgs/{tenantId}/contact_merge_suggestions/{suggestionId}
```

## `business_card_imports`

Draft와 원본 이미지의 추적 단위다.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | doc id |
| `tenantId` | string | yes | org scope |
| `status` | string | yes | `needs_review`, `saved`, `failed` |
| `storagePath` | string | yes | private Firebase Storage path |
| `fileName` | string | yes | safe original filename |
| `mimeType` | string | yes | `image/jpeg`, `image/png`, `image/webp` |
| `fileSize` | number | yes | uploaded byte size |
| `uploadedBy` | string | yes | actor uid |
| `uploadedByEmail` | string | no | actor email |
| `createdAt` | string | yes | ISO |
| `updatedAt` | string | yes | ISO |
| `geminiProvider` | string | no | `vertex-ai` |
| `geminiModel` | string | no | env-selected model |
| `rawText` | string | no | Gemini extracted raw text summary |
| `extracted` | object | no | normalized draft fields |
| `error` | object | no | safe error code/message |
| `contactId` | string | no | set when confirmed |

## `contacts`

전사 검색 가능한 canonical 연락처다.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | string | yes | doc id |
| `tenantId` | string | yes | org scope |
| `visibility` | string | yes | v1 default `org` |
| `name` | string | conditional | name or organization required |
| `organization` | string | conditional | name or organization required |
| `department` | string | no | extracted/reviewed |
| `title` | string | no | 직함 |
| `role` | string | no | 직책/업무 역할 |
| `emails` | string[] | no | normalized lowercase |
| `phones` | string[] | no | normalized E.164-like where possible |
| `website` | string | no | normalized URL |
| `address` | string | no | free text |
| `memo` | string | no | user note |
| `sourceImportId` | string | yes | original import |
| `imageStoragePath` | string | yes | private image |
| `searchTokens` | string[] | yes | normalized search tokens |
| `normalizedName` | string | yes | write-time generated field for search/ranking |
| `normalizedOrganization` | string | yes | write-time generated field for search/ranking |
| `primaryEmail` | string | no | first normalized email |
| `primaryPhone` | string | no | first normalized phone |
| `emailKeys` | string[] | yes | lowercase exact-match keys |
| `phoneKeys` | string[] | yes | punctuation-stripped exact-match keys |
| `phoneDigits` | string[] | yes | digit-only keys for partial lookup |
| `nameTrigrams` | string[] | yes | capped duplicate-candidate tokens |
| `organizationTrigrams` | string[] | yes | capped duplicate-candidate tokens |
| `quality` | object | yes | BFF-computed quality summary |
| `normalizationVersion` | number | yes | reindex migration marker |
| `extractionSchemaVersion` | number | yes | Gemini extraction schema marker |
| `createdBy` | string | yes | actor uid |
| `updatedBy` | string | yes | actor uid |
| `createdAt` | string | yes | ISO |
| `updatedAt` | string | yes | ISO |

## Storage Path

```text
orgs/{tenantId}/business-cards/{actorId}/{importId}-{safeFileName}
```

Rules:

- Firebase download token을 만들지 않는다.
- public download URL을 저장하지 않는다.
- image view는 BFF endpoint가 Storage stream을 proxy한다.

## Required Validation

Contact 저장 조건:

```text
(name != "" OR organization != "")
AND
(emails.length > 0 OR phones.length > 0)
```

Search token 생성 대상:

```text
name + organization + department + title + role + emails + phones
```

PostgreSQL generated column처럼 BFF가 저장 시점에 검색/중복용 파생 필드를 만든다.
Firestore에서는 DB가 자동 생성 컬럼을 보장하지 않으므로, contact 생성/수정 service layer에서 `buildContactDerivedFields()`를 반드시 통과시킨다.

## Acceptance

- `business_card_imports`와 `contacts`의 관계가 `sourceImportId`와 `contactId`로 양방향 추적된다.
- 원본 이미지 경로는 contact에도 남지만 public URL은 남지 않는다.
- 검색 토큰은 개인정보 원문 전체 복제가 아니라 검색 가능한 최소 문자열로 제한한다.
