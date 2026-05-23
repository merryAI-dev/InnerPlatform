---
id: business-card-db-search-dedupe-quality
status: implemented
depends_on:
  - business-card-db-data-model
unblocks:
  - business-card-db-review-save-search
  - business-card-db-test-qa-release
---

# 06 Search Dedupe Quality

## Search Tokens

Generate tokens from:

```text
name
organization
department
title
role
emails
phones
```

Token rules:

- lowercase English
- trim whitespace
- remove phone punctuation
- include Korean full string and whitespace-less variant
- include email local/domain tokens for practical search
- include capped 4-digit phone fragments for partial phone search
- exclude tokens shorter than 2 chars except Korean names of 2 chars
- cap token count to 80 per contact

## PostgreSQL-Inspired Structure

PostgreSQL `tsvector + setweight + ts_rank` maps to Firestore like this:

| PostgreSQL idea | Firestore/BFF translation |
| --- | --- |
| stored generated columns | BFF write-time derived fields |
| `tsvector` | capped `searchTokens` |
| weighted ranking | BFF `S_search` ranking |
| `citext` / lower expression index | lowercase `emailKeys` |
| expression index on normalized phone | `phoneKeys` and `phoneDigits` |
| `pg_trgm` candidate lookup | capped `nameTrigrams`, `organizationTrigrams` |
| trigger/audit table | BFF append-only audit event |

Do not copy PostgreSQL full text search wholesale into Firestore. Firestore candidate lookup remains small and explicit; ranking happens in the BFF.

## Search Ranking

```text
S_search =
  3.0 * name_match
+ 2.5 * email_match
+ 2.0 * phone_match
+ 1.5 * organization_match
+ 1.0 * title_match
+ 0.2 * recency_boost
```

```text
recency_boost = 1 / (1 + days_since_updated / 30)
```

Match values:

```text
exact = 1.0
prefix = 0.8
contains = 0.5
none = 0.0
```

## Duplicate Candidate Score

```text
S_dup =
  0.50 * email_exact
+ 0.30 * phone_exact
+ 0.12 * name_trigram_similarity
+ 0.08 * organization_trigram_similarity
```

```text
trigram_similarity = |A ∩ B| / |A ∪ B|
```

Thresholds:

```text
S_dup >= 0.85        strong duplicate candidate
0.65 <= S_dup < 0.85 review candidate
S_dup < 0.65         hidden
```

v1 rule:

- Never auto-merge.
- Show duplicate candidates after review save or inside review screen.
- Store suggestions separately only if needed for later queue review.

## Quality Status

Contact quality:

```text
Q_contact =
  0.25 * has_name
+ 0.20 * has_organization
+ 0.25 * has_email_or_phone
+ 0.15 * average_field_confidence
+ 0.15 * user_confirmed
```

Thresholds:

```text
Q_contact >= 0.80  good
0.55 <= Q_contact < 0.80  usable
Q_contact < 0.55  weak
```

## Acceptance

- Search ranking is deterministic for the same query and data.
- Duplicate candidates are explainable by matched email/phone/name/org signals.
- Weak quality contacts remain searchable but show a warning in admin views.
- Large free-text fields such as `rawText`, `extracted`, `memo`, and `address` are excluded from Firestore automatic indexing where practical.
