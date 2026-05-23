---
id: business-card-db-security-privacy-rbac
status: implemented
depends_on:
  - business-card-db-data-model
  - business-card-db-api-contract
unblocks:
  - business-card-db-test-qa-release
---

# 05 Security Privacy RBAC

## Policy Decisions

| Topic | Decision |
| --- | --- |
| Contact visibility | `org`, 전사 검색 |
| Image retention | 계속 보관 |
| Image public URL | 금지 |
| Client direct Storage access | 금지 |
| Gemini access | BFF server only |
| Human review | 필수 |

## Role Access

All authenticated internal roles can read org-visible contacts.

| Action | Roles |
| --- | --- |
| `contact:read` | admin, finance, pm, viewer |
| `contact:write` | admin, finance, pm, viewer |
| `contact:image:read` | admin, finance, pm, viewer |
| `contact:delete` | admin |

All contact actions go through BFF. Firestore client SDK direct access is denied for:

```text
orgs/{tenantId}/contacts/**
orgs/{tenantId}/business_card_imports/**
orgs/{tenantId}/contact_events/**
```

## Audit Events

Required audit events:

```text
business_card_import.process
business_card_import.gemini_failed
business_card_import.confirm
business_card_import.image_view
contact.search
contact.create
contact.update
```

Search audit must not store raw query. Store:

```text
queryHash = sha256(normalizedQuery + tenantScopedSalt)
resultCount
actorId
occurredAt
```

## Image Access

Image endpoint behavior:

1. Resolve actor and tenant.
2. Load import doc by `tenantId` and `importId`.
3. Verify actor can read org-visible contacts.
4. Write `business_card_import.image_view` audit event.
5. Stream private Storage object.

Never return:

```text
downloadURL
firebaseStorageDownloadTokens
signed public URL
storagePath in API responses
```

## Privacy Notes

- 전사 검색은 의도된 정책이지만, raw image는 UI에서 필요한 경우에만 노출한다.
- 검색 결과 기본 목록에는 주소와 메모를 접어서 표시한다.
- 삭제/비식별화는 v1 이후 운영 정책으로 별도 설계한다.

## Acceptance

- 인증 없는 image endpoint 요청은 401/403이다.
- 다른 tenant의 import image는 접근할 수 없다.
- 검색 audit에는 raw query가 남지 않는다.
- Storage metadata에 Firebase download token이 없다.
