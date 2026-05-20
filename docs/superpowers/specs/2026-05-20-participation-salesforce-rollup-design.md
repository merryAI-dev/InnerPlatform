# Participation Salesforce Rollup Design

## Goal

Make the admin participation surface feel like a Salesforce list workspace while keeping live data safe. The first visual grouping should be the original project classification: e나라도움, KOICA, 회계사정산, and 민간/기타.

## Data Boundary

`participationEntries` stays the formal participation source. `Project.teamMembersDetailed` is merged only for display through a deterministic helper. Persisted `PROJECT_TEAM_SYNC` rows are treated as stale derived rows and excluded before current project team rows are regenerated.

No new writes, permission changes, API keys, or background sync are introduced.

## UX Shape

The admin participation page uses a compact object header, then origin classification lanes. Each lane shows project count, member count, total participation, over-limit count, and a few project chips. The detailed list tables remain below so users can move from classification to person or project detail.

## Risk Rules

Type5 or dedicated account project-team rows are counted as e나라도움 for rollup display. KOICA is detected from the contract target text and gets its own lane for same-institution review. Formal participation rows override display-derived team rows when names match by real name, nickname, or combined display name.

## Verification

Regression coverage should confirm stale sync rows are ignored, real-name-only formal rows do not duplicate team rows, employee options stay aligned with the canonical employee list, and participation terminology does not drift back to legacy visible terms.
