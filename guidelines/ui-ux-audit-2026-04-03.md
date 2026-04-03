# UI/UX Audit Backlog

Date: 2026-04-03
Scope: InnerPlatform admin + PM portal
Method: `ui-ux-pro-max` heuristic review + local Playwright capture

## Evidence

- Admin dashboard: `output/playwright/ui-audit-final/admin-dashboard.png`
- Project list: `output/playwright/ui-audit-clicked/project-list.png`
- Project detail: `output/playwright/ui-audit-clicked/project-detail.png`
- Portal dashboard: `output/playwright/ui-audit-clicked-portal/portal-dashboard.png`
- Portal bank statements: `output/playwright/ui-audit-clicked-portal/portal-bank-statements.png`
- Portal weekly expenses: `output/playwright/ui-audit-clicked-portal/portal-weekly-expenses.png`
- Mobile portal dashboard: `output/playwright/ui-audit-final/mobile-portal-dashboard.png`

## Summary

The current product has two opposite problems:

1. Admin screens are too dense.
2. PM task screens hide the primary action or sequence.

This creates avoidable operator fatigue on the admin side and weak onboarding/task clarity on the PM side.

## Prioritized Backlog

### P0

#### 1. PM `통장내역` empty state must promote upload as the primary action

Problem:
- The screen shows a wide empty table shell first.
- The actual upload action is buried in the top toolbar.
- First-time PM users do not get a clear "start here" instruction.

Fix:
- Add a centered empty-state block with one primary CTA: `엑셀 업로드`.
- Add a short 3-step helper flow under the CTA.
- Keep the toolbar action, but demote it once the empty-state CTA exists.

Success criteria:
- A first-time user can identify the first action within 3 seconds.
- Empty state explains what file is accepted and what happens next.

#### 2. PM `사업비 입력(주간)` must show task order before tool density

Problem:
- The screen opens with multiple banners and a dense spreadsheet toolbar.
- The user sees controls before understanding the input sequence.

Fix:
- Compress top notices into a single prioritized status block.
- Add a compact "이번 화면에서 할 일" checklist above the grid.
- Keep advanced spreadsheet controls collapsible or secondary.

Success criteria:
- A PM can understand the sequence: `주차 확인 -> 항목 분류 -> 금액 검토 -> 저장`.
- The first screenful prioritizes task guidance over spreadsheet chrome.

### P1

#### 3. Admin dashboard needs stronger information hierarchy

Problem:
- Welcome banner, KPI cards, alerts, risk list, and secondary cards all compete visually.
- There is no single dominant "what requires action now" area.

Fix:
- Rebuild top-of-page hierarchy into 3 layers:
  - action strip
  - critical alerts
  - secondary metrics
- Move low-urgency cards lower.
- Reduce the width and visual weight of the welcome banner.

Success criteria:
- An admin can identify the top 3 urgent tasks without scanning the full page.

#### 4. Project list density is too high for operational scanning

Problem:
- Too many columns compete at once.
- Small type and weak contrast increase scan cost.
- Filters and tabs sit above an already overloaded table.

Fix:
- Split into a default compact table and an optional detailed view.
- Freeze the most important columns: project, owner, status, contract amount.
- Push lower-priority fields into row expansion or detail drawer.

Success criteria:
- Operators can scan status and ownership quickly without horizontal fatigue.

#### 5. Project detail should separate status, risk, and metadata

Problem:
- The page is readable, but it does not clearly separate:
  - current business status
  - next action
  - supporting metadata

Fix:
- Add a top summary rail for status, risk, and recommended next action.
- Group detail cards by decision purpose rather than raw field type.
- Keep destructive actions visually strong but contextually explained.

Success criteria:
- A user can tell the current condition and next step without reading all cards.

### P2

#### 6. Workspace selection and local login messaging should be less confusing

Problem:
- In local mode, Firebase-disabled messaging appears before the actual demo login path.
- Workspace selection adds friction every time.

Fix:
- In local/demo mode, make the harness entry the primary path.
- Demote Firebase-disabled messaging to secondary helper text.
- Revisit whether workspace selection should be shown every login.

Success criteria:
- Local/demo users enter the correct workspace without parsing an error-looking state.

#### 7. Mobile PM navigation should expose primary work routes faster

Problem:
- High-frequency actions are hidden behind the menu.
- The mobile dashboard spends too much first-screen space on summary cards.

Fix:
- Expose a bottom quick-action bar or sticky shortcuts for:
  - `통장내역`
  - `사업비 입력(주간)`
  - `캐시플로(주간)`
- Move lower-value summary content downward on mobile.

Success criteria:
- Core PM work routes are reachable in one tap from the first screen.

## Proposed Execution Order

1. PM `통장내역` empty state
2. PM `사업비 입력(주간)` top section simplification
3. Admin dashboard hierarchy pass
4. Project list density reduction
5. Project detail summary restructuring
6. Login/workspace and mobile navigation cleanup

## Notes

- Existing local worktree already contains unrelated in-progress project trash/BFF changes.
- This backlog/issue/PR should stay documentation-only first, then implementation can be layered on top intentionally.
