---
id: business-card-db-vertex-gemini-extraction
status: implemented
depends_on:
  - business-card-db-api-contract
unblocks:
  - business-card-db-review-save-search
---

# 03 Gemini Extraction

## Runtime

Use the Google Gen AI SDK on the BFF server. The fast setup path uses a Google AI Studio API key. The enterprise setup path uses Vertex AI.

Environment:

```text
GEMINI_API_KEY=<Google AI Studio API key>
BUSINESS_CARD_GEMINI_MODEL=gemini-2.5-flash
```

Vertex AI environment:

```text
GOOGLE_GENAI_USE_VERTEXAI=true
GOOGLE_CLOUD_PROJECT=inner-platform-live-20260316
GOOGLE_CLOUD_LOCATION=global
BUSINESS_CARD_GEMINI_MODEL=gemini-2.5-flash
```

If `GEMINI_API_KEY` is present, the BFF uses the API key path first. If it is absent, the BFF falls back to Vertex AI when `GOOGLE_GENAI_USE_VERTEXAI=true`.

## Input

- One image per request
- Supported MIME: `image/jpeg`, `image/png`, `image/webp`
- Client target size: <= 3MB
- Server hard limit: <= 8MB

## Prompt Contract

System intent:

```text
You extract contact details from a Korean or bilingual business card image.
Return ONLY valid JSON that matches the response schema.
Do not wrap it in Markdown.
Do not infer personal data that is not visible on the card.
```

Korean business-card rules:

- Prefer the printed Korean name when Korean and romanized names refer to the same person.
- Separate organization from internal unit. Organization cues include `(주)`, `주식회사`, `유한회사`, `재단법인`, `사단법인`, `센터`, `연구소`, `랩`, `CIC`, `본부`, and `사업부`. Department cues include `팀`, `본부`, `센터`, `실`, `부`, `랩`, `CIC`, `파트`, and `그룹`.
- Keep formal rank/job title in `title`; keep functional responsibility such as project, marketing, development, operations, or partnership scope in `role`.
- Include mobile, telephone, and direct numbers. Do not classify fax as a normal phone number unless no other reachable number is visible.
- Capture a website only when it is visibly printed; do not infer it from an email domain.
- Keep Korean addresses as a single field with postal code, building, floor, room, and road/lot details when visible.
- `evidence` must be a visible supporting snippet, not a generic label such as `Tel` or `Email`.
- If multiple cards or people are visible, extract the largest/most complete/frontmost card and add a warning.
- If Korean/English sides duplicate the same card, merge and deduplicate phones and emails.

Research notes:

- Playwright Google Images sampling was attempted, but Google returned an automated-traffic block page, so direct visual sampling was not reliable enough to use as a source artifact.
- Prompt improvements were instead informed by public OCR/business-card references: Meishi's notes on mixed scripts, layout issues, and fax/field swaps (`https://meishi.dev/`); Pixlane's field set and raw OCR review flow (`https://pixlane.media/en-us/business-card-ocr/`); and GitHub examples that combine OCR text with structured JSON extraction (`https://gist.github.com/interns24-bit/e646a8c2df90d1e97f5e56b00d3f0377`).

## Structured Output

Every scalar field is represented as:

```json
{
  "value": "string",
  "confidence": "high",
  "evidence": "visible text snippet"
}
```

Arrays:

```json
{
  "emails": [
    { "value": "hello@example.com", "confidence": "high", "evidence": "hello@example.com" }
  ],
  "phones": [
    { "value": "01012345678", "confidence": "high", "evidence": "010-1234-5678" }
  ]
}
```

Required top-level fields:

```text
name
organization
department
title
role
emails
phones
website
address
memo
rawText
warnings
```

## Normalization

- Email: lowercase and trim
- Phone: remove spaces, hyphens, parentheses; keep leading `+` when present
- Website: add `https://` only if domain is explicit and scheme is absent
- Confidence: unknown values become `low`
- Evidence: max 160 chars per field

## Confidence Formula

```text
score(high) = 0.90
score(medium) = 0.65
score(low) = 0.35
score(empty) = 0.00
```

```text
C_field = 0.70 * C_gemini + 0.20 * C_rule + 0.10 * C_user_confirmed
```

Rules:

- `C_rule = 1` when email/phone/url format validation passes.
- `C_rule = 0` when validation fails or no deterministic rule exists.
- `C_user_confirmed = 1` only after confirm.
- `C_field < 0.60` must show a low-confidence indicator in review UI.

## Failure Policy

- Gemini network/API failure: create import as `failed` if image upload succeeded.
- Malformed JSON: create import as `needs_review` with empty extracted fields and warning.
- Unsupported image: reject before Storage upload.

## Acceptance

- Gemini response is always validated by server-side schema before it reaches the UI.
- Low-confidence fields are not silently hidden.
- No hallucinated fields are accepted without user confirmation.
