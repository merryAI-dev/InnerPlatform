# QA Feedback Memory Boundary Plan

## Context

The previous review was launched from `/Users/boram`, which is not a Git repository. The actionable repository for this cleanup is `/Users/boram/InnerPlatform`, currently on `fix/portal-onboarding-bypass`.

The QA feedback memory mixed two products:

- InnerPlatform: 사업관리플랫폼
- startup-diagnostic-platform: 기업육성플랫폼

This made automated review and follow-up planning noisy because issues from a different product could appear in InnerPlatform planning.

## Decision

Use `docs/operations/qa-feedback-memory.json` and `docs/operations/qa-feedback-memory.md` as the InnerPlatform-only working memory.

Keep the original combined export as a preserved reference:

- `docs/operations/qa-feedback-memory.combined.json`
- `docs/operations/qa-feedback-memory.combined.md`

Record the product and URL split in:

- `docs/operations/platform-boundary.md`

## Commit Scope

Include:

- InnerPlatform-only QA feedback memory.
- Combined QA feedback memory backup.
- Platform boundary reference.
- This cleanup plan.
- `.gitignore` rules for local browser/output artifacts.

Exclude:

- `.playwright-cli/`
- `output/`
- transient local screenshots, logs, and generated document exports.

## Verification Plan

1. Confirm the InnerPlatform working memory has only `사업관리플랫폼` and `미분류` entries.
2. Confirm the combined backup still contains both product families.
3. Run the targeted QA feedback memory test.
4. Run a repository diff check before commit.

## Follow-Up

Use this boundary when filing or triaging follow-up issues:

- InnerPlatform fixes should reference only the InnerPlatform working memory.
- startup-diagnostic-platform items should move to the startup diagnostic repository or its own tracker.
- Review commands should be launched from a repository root, not `/Users/boram`.
