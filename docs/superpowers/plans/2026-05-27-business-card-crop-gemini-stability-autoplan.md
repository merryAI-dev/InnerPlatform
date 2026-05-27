# Business Card Crop + Gemini Stability Autoplan

Date: 2026-05-27
Branch: `feat/business-card-gemini-api-key`
Stage URL: `https://inner-platform-git-dev-merryai-devs-projects.vercel.app`

## Understand Baseline

`/understand` graph exists, but it is stale for this feature.

- Graph commit: `74978f3936ebd15080c66044ffde6b3db9a2cbad`
- Last analyzed: `2026-05-26T01:39:27.159Z`
- Business-card nodes in graph: `0`

Decision: use the graph only as platform dependency background and treat current source inspection as the source of truth for 명함 DB.

Current dependency chain:

```text
BusinessCardLabPage.tsx
  -> prepareBusinessCardImage(file)
     -> readFileAsDataUrl
     -> loadImage
     -> canvas resize/compress to JPEG
  -> processBusinessCardViaBff(...)
     -> POST /api/v1/business-card-imports/process
        -> routes/business-cards.mjs
           -> uploadBusinessCard(...)
           -> analyzeBusinessCard(...)
              -> @google/genai GoogleGenAI.models.generateContent
```

## Immediate Fix: Gemini Cannot Be Used

Observed root causes:

- Vercel `GEMINI_API_KEY` contained surrounding console text, not only the raw API key.
- `gemini-2.5-flash` can return transient `503 UNAVAILABLE` / high-demand failures.

Applied stabilization:

- Preview and Production `GEMINI_API_KEY` are now clean `AIza...` values.
- Preview and Production now have `BUSINESS_CARD_GEMINI_FALLBACK_MODELS=gemini-2.5-flash-lite`.
- BFF now retries retryable Gemini capacity failures with the fallback model list.
- API key reachability was verified with a non-image Gemini call without printing the key.

## Crop Strategy

Goal: improve extraction accuracy by sending Gemini the card area, not the whole desk/background image.

Principles:

- Do not add OpenCV or a heavy WASM dependency in v1.
- Keep crop client-side before upload so Storage and Gemini both receive a smaller, cleaner image.
- Never silently destroy user intent: show crop confidence and allow original image fallback.
- Prefer deterministic image processing over model-dependent pre-processing.

Phase A: deterministic axis-aligned crop

- Add a pure crop detector near `business-card-image.ts`.
- Downsample image to an analysis canvas, max 512-768px.
- Estimate background from border pixels.
- Detect the largest rectangular area by contrast from surrounding background, favoring bright low-saturation card surfaces.
- Validate confidence with area ratio, aspect ratio, and edge strength.
- If confidence is high enough, crop with 3-6% padding before JPEG compression.
- If confidence is low, keep the original image and mark crop as skipped.

Phase B: UX guardrails

- Add image metadata to `BusinessCardPreparedImage`:
  - `crop.applied`
  - `crop.confidence`
  - `crop.bounds`
  - `crop.reason`
- In `BusinessCardLabPage`, show a compact status near the preview:
  - `명함 영역 자동 정리됨`
  - `원본 이미지 사용 중`
- Add `원본 사용` when automatic crop looks wrong.

Phase C: perspective correction only after QA

- If mobile photos often show rotated/perspective cards, add four-corner detection and perspective correction.
- Do not start with this because it has higher math and QA cost than axis-aligned crop.

## QA Hypotheses

High-risk cases to test before landing crop:

- White card on white desk: detector should skip or keep original, not crop random whitespace.
- Multiple cards in one photo: detector should choose largest/frontmost and Gemini prompt already warns about multi-card images.
- Receipt/document mistaken as business card: detector may crop it, but review screen still prevents blind save.
- Dark mode UI and image preview: crop badge must not create confusing green/yellow/red decoration.
- iOS camera images: browser image decode usually honors orientation, but mobile QA must confirm portrait captures.

## Implementation Plan

1. Stabilize Gemini runtime first.
   - Done in this branch: clean env, fallback env, retryable model fallback, tests.

2. Add crop detector as isolated image utility.
   - Create tests around synthetic `ImageData` so the algorithm can be QAed without browser flakiness.
   - Keep `prepareBusinessCardImage` as the only integration point.

3. Add reviewable crop UI.
   - Keep current upload flow.
   - Add crop status and original fallback control.
   - Do not change the BFF contract unless crop metadata becomes operationally useful.

4. Run QA loop.
   - Unit: crop detector fixtures.
   - Integration: `BusinessCardLabPage.shell.test.tsx` and image prep tests.
   - Browser: mobile viewport upload UI, preview rendering, process button state.
   - Stage: upload a real card photo and confirm Gemini fields are populated.

5. Release gate.
   - Stage alias only: `inner-platform-git-dev-merryai-devs-projects.vercel.app`.
   - No random preview URL for auth testing.
   - Production deploy only after mobile capture, extraction, review-save, and search are confirmed.

## Decision

Proceed with Gemini stability hotfix now. Start crop as a separate small implementation after this commit so the production-risky AI runtime fix and the image-processing UX change are not tangled.
