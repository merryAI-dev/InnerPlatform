# Cashflow ERP settlement UX

**Date:** 2026-07-22
**Status:** complete — independent audit 100/100
**Gate:** 100/100 before Stage deployment

## Scope

- Apply a restrained ERP visual language to the cashflow dashboard and ledger:
  neutral gray surfaces, navy for primary state/action, pale yellow for totals
  and review, and red only for an error.
- Put weekly settlement and monthly close in one primary dashboard action area;
  retain the ledger header as status and period context rather than a second
  competing action bar.
- Open month close as a short preflight dialog.  A missing setup, stale/missing
  fixed sheet snapshot, unavailable server state, and pre-close date must each
  name the exact next action instead of showing a generic "connect a sheet"
  error.
- Emit bounded, redacted browser diagnostics through the existing
  `cashflow_transaction` developer log for month-status loading, review open,
  blocked preflight, explicit sheet refresh, monthly close, and weekly
  settlement.

## Success criteria

- [x] Each JVM command's allowed active user sees its corresponding `주간 정산 완료`
  or `월 결산` action at the top of the cashflow dashboard when the selected
  year has weekly data.
- [x] The monthly dialog routes an unconfigured project to sheet settings, a
  configured but non-fixed project to explicit `시트 값 불러오기`, and an
  unavailable server result to `결산 상태 다시 확인`.
- [x] A pre-close date is explained without presenting a generic sheet error.
- [x] The final close command stays the existing JVM-backed atomic command;
  this UI phase does not change its authority, revision, lock, or reopen
  rules.
- [x] Stage developer tools show safe operation names, timing, project/month,
  state summaries, and sanitized errors, never tokens, authorization headers,
  emails, raw cells, or amounts.
- [x] Cashflow shell tests, tooltip tests, production build, and diff check
  pass without Docker.

## Failure criteria

- A month-close action disappears merely because the preflight state failed.
- An error asks the user to connect a sheet when an existing sheet only needs
  an explicit refresh or a status retry.
- A UI condition bypasses the server final-close contract.
- Developer diagnostics contain a credential, access token, email, or raw
  financial payload.
- The visual refactor adds unrelated product behavior or any Live deployment.

## Out of scope

- Changes to the BFF/JVM month-close, weekly-lock, reopen, or authorization
  contracts.
- Automatic sheet polling or automatic overwrite.
- New persistence, queues, caches, Docker, or dependency additions.
- Live deployment.

## Evaluation record

- Focused cashflow UI, action-tooltip, Devtools, and BFF-client tests:
  51/51 passed with one worker.
- `npm run qa:understand:gate`: passed. The gate now checks the actual
  settlement action, preflight entry point, and preflight state instead of an
  obsolete amount-input implementation detail.
- Production Vite build: passed, 2,910 modules transformed, 28.04 seconds.
- `npm run policy:verify` and `git diff --check`: passed.
- Independent read-only audit: 100/100.
- Audit specifically replayed an API response with
  `body.error='sk_live_supersecret'` and a raw amount; the serialized browser
  Devtools log contained neither value.
- Docker was not used. Live deployment remains excluded.

## Visual follow-up

- Cashflow tables use white/slate zebra rows throughout each item row. Item
  rails were removed; income labels use muted green, expense labels muted red,
  and non-zero Projection–Actual differences use sky blue.
- Dashboard surfaces use existing Tailwind semantic tokens: `background`,
  `card`, `secondary`, `accent`, and `border`. This keeps the weekly/monthly
  settlement divider, rate cards, and management checks on one 1px rule in
  both light and dark modes.
- Focused cashflow shell tests: 34/34 passed. Final production build passed
  in 2m 13s. Independent visual audit: 100/100.
